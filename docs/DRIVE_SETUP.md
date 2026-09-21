# Google Drive setup for accepted submissions

What you do here is the Google/Supabase side. The code is already in the repo:
`supabase/functions/push-to-drive`, the review UI in `TaskDocuments`, and migration `20260920000500`.

Flow: employee submits a file on a task -> manager opens the task -> **Accept** (pick a folder; the file is copied
to Google Drive) or **Reject** (with a note the team can see).

## 0. Read this first: service accounts cannot write to a normal Drive

A Google **service account has no storage of its own**, so uploading into a folder in someone's regular *My Drive*
fails with `storageQuotaExceeded` ("Service Accounts do not have storage quota"). Pick one path:

| You have | Use | Files are owned by |
|---|---|---|
| Google Workspace (paid) | **Path A**: Shared Drive + service account | the Shared Drive (your organisation) |
| Personal Gmail | **Path B**: Apps Script bridge (recommended) | you (counts against your Drive storage) |
| Personal Gmail **and** a domain you own | **Path C**: OAuth refresh token | you |

Why not plain OAuth on a personal Gmail? Google only lets an external OAuth app leave "Testing" mode if it has a homepage and
privacy-policy page on a domain you own, and in Testing mode refresh tokens expire after 7 days. Path B avoids all of that.

The function supports all three and picks in this order: Apps Script secrets, then OAuth secrets, then the service account.

## 1. Google Cloud project (Paths A and C only; skip for Path B)
1. https://console.cloud.google.com -> new project "Verlyn Tech Dashboard".
2. APIs & Services -> Library -> enable **Google Drive API**.

## 2A. Path A: Shared Drive + service account
1. APIs & Services -> Credentials -> Create credentials -> Service account (name `verlyntech-dashboard`, skip the optional steps).
2. Open it -> Keys -> Add key -> JSON. Keep the file private; never commit it.
3. In Drive, create a **Shared Drive** (e.g. "Verlyn Tech"). Add the service account's `client_email` as a member with **Content manager**.
4. Inside the Shared Drive create the folders in section 3 and copy each folder ID.

## 2B. Path B: Apps Script bridge (personal Gmail)
A small Google Apps Script runs as you and saves files into your folders. The Supabase function sends it the file plus a shared secret.
No OAuth consent screen, no verification, no tokens that expire.

1. Go to https://script.google.com, signed in as the Google account that owns the folders -> **New project**.
   Name it `Verlyn Tech Drive bridge`.
2. Delete the sample code and paste in the contents of `docs/apps-script/Code.gs` from this repo. Click **Save**.
3. Make a secret. In cmd:
   ```bat
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   ```
   Copy the output (48 characters).
4. In the script editor: **Project Settings** (gear icon) -> **Script properties** -> **Add script property**.
   Property `SECRET`, value = the secret from step 3 -> **Save script properties**.
5. **Deploy -> New deployment** -> gear icon next to "Select type" -> **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy**. When asked to authorize, choose your account; if you see "Google hasn't verified this app", click
     **Advanced -> Go to Verlyn Tech Drive bridge (unsafe) -> Allow**. That is just you approving your own script.
6. Copy the **Web app URL** (ends in `/exec`). You'll need it with the secret in section 4.

If you edit the script later: Deploy -> Manage deployments -> pencil icon -> Version: **New version** -> Deploy. The URL stays the same.

"Anyone" can reach the URL, but without the secret the script answers "unauthorized" and does nothing.

## 2C. Path C: OAuth as your own account (only if you own a domain)
Needs a homepage and privacy-policy page on a domain you own, added under Branding and Authorized domains, so the app can be published.
Do **not** skip publishing: tokens issued in Testing mode die after 7 days, and publishing later doesn't extend a token you already have.
1. OAuth consent screen: External, then **Publish app** (Audience page). 2. Credentials -> OAuth client ID -> Web application, redirect URI
`https://developers.google.com/oauthplayground`. 3. In the OAuth Playground use your own credentials, scope
`https://www.googleapis.com/auth/drive`, authorise, exchange the code, copy the **refresh token**. 4. Set the three `GOOGLE_OAUTH_*` secrets below.

## 3. Folders (create all eight) and their secrets
Path A: inside the Shared Drive. Paths B and C: anywhere in your own Drive.


| Drive folder | Folder key | Secret name |
|---|---|---|
| Submissions (general landing) | `general` | `DRIVE_SUBMISSIONS_FOLDER_ID` |
| Marketing | `marketing` | `DRIVE_MARKETING_FOLDER_ID` |
| Legal | `legal` | `DRIVE_LEGAL_FOLDER_ID` |
| Technical | `technical` | `DRIVE_TECHNICAL_FOLDER_ID` |
| Sales | `sales` | `DRIVE_SALES_FOLDER_ID` |
| Automations | `automations` | `DRIVE_AUTOMATIONS_FOLDER_ID` |
| Finance | `finance` | `DRIVE_FINANCE_FOLDER_ID` |
| Lead Gen | `lead-gen` | `DRIVE_LEAD_GEN_FOLDER_ID` |

The folder ID is the last part of the folder's URL: `https://drive.google.com/drive/folders/<FOLDER_ID>`.
`DRIVE_ROOT_FOLDER_ID` from the original brief is not used.

## 4. Set the secrets (Windows cmd friendly)
Pasting JSON into `supabase secrets set KEY={...}` breaks in cmd, so use a file. Copy `supabase\.env.drive.example` to `supabase\.env.drive`, or create it
(the `.env.*` pattern in `.gitignore` already keeps it out of git):

```
DRIVE_SUBMISSIONS_FOLDER_ID=...
DRIVE_MARKETING_FOLDER_ID=...
DRIVE_LEGAL_FOLDER_ID=...
DRIVE_TECHNICAL_FOLDER_ID=...
DRIVE_SALES_FOLDER_ID=...
DRIVE_AUTOMATIONS_FOLDER_ID=...
DRIVE_FINANCE_FOLDER_ID=...
DRIVE_LEAD_GEN_FOLDER_ID=...

# Path B (Apps Script bridge) - personal Gmail:
GOOGLE_APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec
GOOGLE_APPS_SCRIPT_SECRET=<the 48-character secret from step 3>

# Path A only (whole JSON key file on ONE line, wrapped in single quotes):
# GOOGLE_SERVICE_ACCOUNT='{"type":"service_account", ... }'

# Path C only:
# GOOGLE_OAUTH_CLIENT_ID=...
# GOOGLE_OAUTH_CLIENT_SECRET=...
# GOOGLE_OAUTH_REFRESH_TOKEN=...
```

Then, from the project root:

```bat
supabase secrets set --env-file supabase\.env.drive
del supabase\.env.drive
supabase db push
supabase functions deploy push-to-drive --use-api
```

Optional: `supabase secrets set ALLOWED_ORIGIN=https://your-vercel-domain` to restrict CORS.

## 5. Test
1. Employee: open a task, **Submit document**.
2. Manager: open the same task -> **Accept** -> choose a folder -> "Accept and save to Drive". The file should appear in that Drive folder
   and the row should show **Accepted** with an "Open in Google Drive" link.
3. Submit another and **Reject** it with a note; the employee should see the note under the file.
4. The manager dashboard has a **To review** card (click it to filter) and a "N to review" tag on tasks.

## 6. Troubleshooting

| Message | Cause |
|---|---|
| "a service account has no storage of its own" | Path A but the folder is in My Drive. Use a Shared Drive, or switch to Path B. |
| "could not find that folder" | Wrong folder ID, or the folder isn't shared with the service account (A) / isn't in your Drive (B). |
| "denied access" | Sharing role too low (needs Content manager/Editor), or the Drive API isn't enabled. |
| "folder for ... is not configured" | That secret is missing. Set it with `supabase secrets set`, then retry. |
| "The Apps Script rejected the request" | `GOOGLE_APPS_SCRIPT_SECRET` doesn't match the script's `SECRET` property. Fix one, re-run `supabase secrets set`, retry. |
| "The Apps Script didn't answer properly" | Deployment isn't "Execute as: Me / Anyone", or the URL isn't the `/exec` one. Check Deploy -> Manage deployments. |
| "Google Apps Script error: ... No item with the given ID" | Wrong or mistyped folder ID, or the folder is in a different Google account than the script. |
| "Could not authenticate with Google" | Bad service account JSON, or the OAuth refresh token expired/revoked (see 2B step 2). |
| "uploaded to Drive but ... could not be marked accepted" | Rare. The file is in Drive (link in the message); check before retrying to avoid a duplicate. |

## 7. Where this differs from the original brief
- **No second table or bucket.** Review lives on `task_documents` (status, reviewer note, reviewer, Drive fields), reusing the private
  `task-docs` bucket and the upload flow that already existed. The brief's SQL would have failed on this database (it referenced
  `tasks.assigned_to_team` and `team_members.profile_id`, which don't exist; ours are `team_id` and `user_id`), used the recursive
  `profiles` policy pattern that broke login earlier, let any signed-in user read or delete any file in the bucket, and let an employee
  insert a row that is already "accepted". All of that is closed in the migration and covered by tests.
- **Only the function can accept.** A manager's browser can reject (note required, HTML stripped, reviewer and time set by the database)
  but cannot mark anything accepted or write Drive fields; only `push-to-drive` (service role) can.
- **Accepted files are locked** against deletion by the uploader; a manager can still delete them.
- **Personal Gmail uses an Apps Script bridge** instead of OAuth (see the table at the top). Untested at the top of the 10 MB limit:
  if a large file fails, lower `MAX_BYTES` and tell me.
- **10 MB per file, not 50 MB.** The free plan has 1 GB total. To raise it, change `MAX_BYTES` in `src/lib/documents.js`, the
  `size_bytes` check on `task_documents`, and the bucket's `file_size_limit`.
- **No upload progress bar** (the Supabase browser upload API doesn't report progress; the button shows "Uploading…").
- **Audit log:** database triggers record reviews and channel changes; no `audit-log` Edge Function is needed.
- **Channels:** the `channels` table and seven default channels exist (marketing, legal, technical, sales, automations, finance, lead-gen).
  Messaging itself (messages, membership, chat UI) is still to be built.
