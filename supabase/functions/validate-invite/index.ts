// validate-invite: UX-only check used by the signup form to preview an invite code's role.
// The real enforcement is the handle_new_user trigger, which re-validates the code atomically.
//
// Rate limit: MAX_FAILURES failed lookups per IP per WINDOW_MS. Only failures count, so many
// legitimate users behind one campus/office IP are not locked out by each other.

import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const PURGE_AFTER_MS = 24 * 60 * 60 * 1000;

// Set ALLOWED_ORIGIN (e.g. https://your-app.vercel.app) with `supabase secrets set` to lock CORS down.
const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });
}

// Service role client — bypasses RLS. Never expose this key to the browser.
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ valid: false, reason: "method_not_allowed" }, 405);

  try {
    const { code } = await req.json();

    if (!code || typeof code !== "string" || code.length > 64) {
      return json({ valid: false, reason: "not_found" }, 400);
    }

    // cf-connecting-ip is set by the edge proxy; x-forwarded-for is client-controllable, so not used.
    const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? "unknown";

    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const { count, error: countError } = await supabase
      .from("invite_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("created_at", since);
    if (countError) throw countError; // fail closed

    if ((count ?? 0) >= MAX_FAILURES) {
      return json(
        { valid: false, reason: "rate_limited" },
        429,
        { "Retry-After": String(WINDOW_MS / 1000) },
      );
    }

    const fail = async (reason: string) => {
      await supabase.from("invite_attempts").insert({ ip });
      await supabase
        .from("invite_attempts")
        .delete()
        .lt("created_at", new Date(Date.now() - PURGE_AFTER_MS).toISOString());
      return json({ valid: false, reason });
    };

    const { data, error } = await supabase
      .from("invite_codes")
      .select("role, used_by, expires_at, single_use")
      .eq("code", code.trim().toUpperCase())
      .maybeSingle();

    if (error) throw error;
    if (!data) return await fail("not_found");
    if (data.single_use && data.used_by !== null) return await fail("used");
    if (data.expires_at && new Date(data.expires_at) < new Date()) return await fail("expired");

    return json({ valid: true, role: data.role });
  } catch (_err) {
    return json({ valid: false, reason: "server_error" }, 500);
  }
});
