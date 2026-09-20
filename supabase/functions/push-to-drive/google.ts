// Google auth + Drive upload helpers for push-to-drive.
// Only uses Web Crypto and fetch (no Deno-specific APIs), so it runs in Deno and Node.

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface GoogleAuthConfig {
  oauth?: OAuthConfig;
  serviceAccount?: ServiceAccount;
}

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";

export class DriveError extends Error {
  status: number;
  reason: string;
  constructor(status: number, reason: string, message: string) {
    super(message);
    this.name = "DriveError";
    this.status = status;
    this.reason = reason;
  }
}

function base64url(data: string | Uint8Array | ArrayBuffer): string {
  const bytes = typeof data === "string"
    ? new TextEncoder().encode(data)
    : data instanceof Uint8Array
    ? data
    : new Uint8Array(data);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): Uint8Array {
  // the JSON key file has "\n" escapes; tolerate secrets where they arrive as literal backslash-n
  const clean = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function signServiceAccountJwt(
  sa: ServiceAccount,
  scope: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope,
    aud: sa.token_uri ?? TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64url(signature)}`;
}

// OAuth (a real Google user's refresh token) works with a personal Drive;
// a service account only works with Shared Drives (service accounts have no storage quota).
export async function getAccessToken(
  config: GoogleAuthConfig,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  let params: URLSearchParams;
  let tokenUrl = TOKEN_URL;

  if (config.oauth) {
    params = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.oauth.clientId,
      client_secret: config.oauth.clientSecret,
      refresh_token: config.oauth.refreshToken,
    });
  } else if (config.serviceAccount) {
    const assertion = await signServiceAccountJwt(config.serviceAccount, DRIVE_SCOPE);
    tokenUrl = config.serviceAccount.token_uri ?? TOKEN_URL;
    params = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    });
  } else {
    throw new Error("No Google credentials configured");
  }

  const res = await fetchFn(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(`Google token request failed: ${json.error_description ?? json.error ?? res.status}`);
  }
  return json.access_token as string;
}

export function buildMultipart(
  metadata: Record<string, unknown>,
  file: Uint8Array,
  mimeType: string,
  boundary: string = `vt_${crypto.randomUUID()}`,
): { body: Uint8Array; contentType: string } {
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--`);

  const body = new Uint8Array(head.length + file.length + tail.length);
  body.set(head, 0);
  body.set(file, head.length);
  body.set(tail, head.length + file.length);
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

export async function uploadToDrive(
  accessToken: string,
  meta: { name: string; parentId: string; description?: string; mimeType: string },
  file: Uint8Array,
  fetchFn: typeof fetch = fetch,
): Promise<{ id: string; webViewLink: string }> {
  const { body, contentType } = buildMultipart(
    { name: meta.name, parents: [meta.parentId], description: meta.description },
    file,
    meta.mimeType,
  );

  // supportsAllDrives: required for folders inside a Shared Drive; harmless for My Drive
  const res = await fetchFn(`${UPLOAD_URL}?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": contentType },
    body,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = json?.error?.errors?.[0]?.reason ?? "unknown";
    throw new DriveError(res.status, reason, json?.error?.message ?? `Drive returned ${res.status}`);
  }
  return { id: json.id, webViewLink: json.webViewLink };
}

// ── Personal Gmail without a verified domain: upload through a Google Apps Script web app ──
// The script (docs/apps-script/Code.gs) runs as the Drive owner, so no OAuth consent screen,
// verification or expiring refresh token is needed. It is protected by a shared secret.

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function uploadViaAppsScript(
  scriptUrl: string,
  secret: string,
  meta: { name: string; parentId: string; description?: string; mimeType: string },
  file: Uint8Array,
  fetchFn: typeof fetch = fetch,
): Promise<{ id: string; webViewLink: string }> {
  const res = await fetchFn(scriptUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret,
      folderId: meta.parentId,
      name: meta.name,
      mimeType: meta.mimeType,
      description: meta.description ?? "",
      data: toBase64(file),
    }),
    redirect: "follow", // Apps Script answers POSTs with a redirect to the result
  });

  const text = await res.text();
  let json: { ok?: boolean; id?: string; url?: string; error?: string };
  try {
    json = JSON.parse(text);
  } catch {
    // usually a Google sign-in / error HTML page: the deployment isn't set to "Anyone"
    throw new DriveError(res.status, "bad_response", "The Apps Script did not return JSON");
  }

  if (!json.ok || !json.id || !json.url) {
    const reason = json.error === "unauthorized" ? "unauthorized" : "apps_script";
    throw new DriveError(res.status, reason, json.error ?? "Apps Script reported a failure");
  }
  return { id: json.id, webViewLink: json.url };
}
