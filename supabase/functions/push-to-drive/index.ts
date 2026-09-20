// push-to-drive: a manager/admin accepts a submitted document and copies it to a Google Drive folder.
//
// POST { submission_id: <task_documents.id>, folder_key: general|marketing|legal|technical|sales|automations|finance|lead-gen }
// Requires the caller's Supabase JWT; the caller's role is read from `profiles`, never from the request.
// Secrets: see docs/DRIVE_SETUP.md.

import { createClient } from "npm:@supabase/supabase-js@2";
import { DriveError, getAccessToken, uploadToDrive, uploadViaAppsScript } from "./google.ts";
import type { GoogleAuthConfig } from "./google.ts";

const FOLDER_KEYS = [
  "general", "marketing", "legal", "technical", "sales", "automations", "finance", "lead-gen",
] as const;
type FolderKey = typeof FOLDER_KEYS[number];

// general -> DRIVE_SUBMISSIONS_FOLDER_ID, lead-gen -> DRIVE_LEAD_GEN_FOLDER_ID, finance -> DRIVE_FINANCE_FOLDER_ID ...
const folderSecretName = (key: FolderKey) =>
  key === "general" ? "DRIVE_SUBMISSIONS_FOLDER_ID" : `DRIVE_${key.toUpperCase().replace(/-/g, "_")}_FOLDER_ID`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function googleConfig(): GoogleAuthConfig | null {
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  const refreshToken = Deno.env.get("GOOGLE_OAUTH_REFRESH_TOKEN");
  if (clientId && clientSecret && refreshToken) return { oauth: { clientId, clientSecret, refreshToken } };

  const raw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT");
  if (!raw) return null;
  try {
    return { serviceAccount: JSON.parse(raw) };
  } catch {
    return null;
  }
}

function friendlyDriveError(e: DriveError): string {
  if (e.reason === "unauthorized") {
    return "The Apps Script rejected the request: GOOGLE_APPS_SCRIPT_SECRET doesn't match the SECRET script property.";
  }
  if (e.reason === "bad_response") {
    return "The Apps Script didn't answer properly. In Deploy > Manage deployments, check it runs as you and that access is set to \"Anyone\", and that the URL is the /exec one.";
  }
  if (e.reason === "apps_script") {
    return `Google Apps Script error: ${e.message}`;
  }
  if (e.reason === "storageQuotaExceeded") {
    return "Google Drive refused the upload: a service account has no storage of its own. " +
      "Put the folders in a Shared Drive, or use the OAuth setup in docs/DRIVE_SETUP.md.";
  }
  if (e.status === 404) {
    return "Google Drive could not find that folder. Check the folder ID and that it is shared with the Google account used.";
  }
  if (e.status === 401 || e.status === 403) {
    return `Google Drive denied access (${e.reason}). Check the folder sharing and the Google credentials.`;
  }
  return `Google Drive error (${e.status}): ${e.message}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1. Who is calling? Verified from their JWT, then role looked up server-side.
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Not signed in" }, 401);
    const caller = userData.user;

    const admin = createClient(url, serviceKey); // bypasses RLS: only used after the checks below

    const { data: profile } = await admin.from("profiles").select("role").eq("id", caller.id).maybeSingle();
    if (!profile || !["manager", "admin"].includes(profile.role)) {
      return json({ error: "Only managers and admins can accept submissions" }, 403);
    }

    // 2. Validate the request.
    const body = await req.json().catch(() => ({}));
    const submissionId: unknown = body.submission_id;
    const folderKey: unknown = body.folder_key;
    if (typeof submissionId !== "string" || !UUID_RE.test(submissionId)) {
      return json({ error: "Invalid submission_id" }, 400);
    }
    if (typeof folderKey !== "string" || !(FOLDER_KEYS as readonly string[]).includes(folderKey)) {
      return json({ error: "Invalid folder_key" }, 400);
    }
    const folderId = Deno.env.get(folderSecretName(folderKey as FolderKey));
    if (!folderId) {
      return json({ error: `The Drive folder for "${folderKey}" is not configured (${folderSecretName(folderKey as FolderKey)}).` }, 500);
    }
    // Upload route: Apps Script (personal Gmail) > OAuth refresh token > service account (Shared Drive)
    const scriptUrl = Deno.env.get("GOOGLE_APPS_SCRIPT_URL");
    const scriptSecret = Deno.env.get("GOOGLE_APPS_SCRIPT_SECRET");
    const useAppsScript = Boolean(scriptUrl && scriptSecret);
    const auth = useAppsScript ? null : googleConfig();
    if (!useAppsScript && !auth) {
      return json({ error: "Google credentials are not configured on the server." }, 500);
    }

    // 3. Load the submission.
    const { data: doc, error: docError } = await admin
      .from("task_documents")
      .select("id, storage_path, filename, mime_type, status, drive_file_url, task:tasks(title)")
      .eq("id", submissionId)
      .maybeSingle();
    if (docError) throw docError;
    if (!doc) return json({ error: "Submission not found" }, 404);
    if (doc.status === "accepted") {
      return json({ error: "This submission was already accepted.", drive_file_url: doc.drive_file_url }, 409);
    }

    // 4. Copy the file from Storage to Drive.
    const { data: blob, error: downloadError } = await admin.storage.from("task-docs").download(doc.storage_path);
    if (downloadError || !blob) return json({ error: "Could not read the file from storage." }, 500);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    let uploaded;
    try {
      const taskTitle = (doc.task as { title?: string } | null)?.title ?? "";
      const meta = {
        name: doc.filename,
        parentId: folderId,
        description: `Task: ${taskTitle}\nSubmission: ${doc.id}`,
        mimeType: doc.mime_type,
      };
      uploaded = useAppsScript
        ? await uploadViaAppsScript(scriptUrl!, scriptSecret!, meta, bytes)
        : await uploadToDrive(await getAccessToken(auth!), meta, bytes);
    } catch (e) {
      if (e instanceof DriveError) return json({ error: friendlyDriveError(e) }, 502);
      console.error("Google auth/upload failed:", e);
      return json({ error: "Could not authenticate with Google. Check the server's Google credentials." }, 502);
    }

    // 5. Record the acceptance (only if nobody else accepted it in the meantime).
    const { data: updated, error: updateError } = await admin
      .from("task_documents")
      .update({
        status: "accepted",
        drive_file_id: uploaded.id,
        drive_file_url: uploaded.webViewLink,
        drive_folder: folderKey,
        reviewed_by: caller.id,
        reviewed_at: new Date().toISOString(),
        reviewer_note: null,
      })
      .eq("id", doc.id)
      .neq("status", "accepted")
      .select("id");

    if (updateError || !updated?.length) {
      // the file is in Drive but the row didn't update: tell the caller where it is
      console.error("Could not record acceptance:", updateError);
      return json({
        error: "The file was uploaded to Drive but the submission could not be marked accepted. Check Drive before retrying.",
        drive_file_url: uploaded.webViewLink,
      }, 500);
    }

    return json({ success: true, drive_file_url: uploaded.webViewLink });
  } catch (e) {
    console.error("push-to-drive error:", e);
    return json({ error: "Unexpected server error." }, 500);
  }
});
