# Verlyn Tech Dashboard: session change log

Session date: 2026-09-20. Baseline: commit `bab6b7e` (what was on GitHub after the first push).
Everything below was done in this one session, in this order.

## 0. How to read this
- **Migrations** are in `supabase/migrations/` and run in filename order.
- **Tested** means tested against a local Postgres with stand-ins for Supabase's `auth` and `storage` schemas.
  Nothing was run against the live Supabase project or in a real browser by me. Lint and `vite build` pass.
- Zips handed over, in order: `vtechdash-fixes`, `vtechdash-fixes-2`, `login-redesign` (v1), `login-redesign-v2`,
  `auth-pages-v3`, `docs-submission`, and the final cumulative zip. The final zip contains every file changed
  since `bab6b7e`, so extracting it over any partial state gives the final result.

## 1. Code review (no code changed)
Findings from reading the repo at `bab6b7e` and the first rebuild:
- Build failed: five lazy-imported pages did not exist (later added by you and pushed).
- Zod 4 removed `error.errors`; `Login.jsx` (2 places) and `Signup.jsx` called it, so validation errors threw.
- Lint errors (3, then 15 after the new pages).
- Signup wrote `role` from the client into `profiles`: anyone could make themselves admin.
- `mark-invite-used` edge function: unauthenticated, service-role key, trusted `invite_id`/`user_id` from the body.
- `validate-invite`: no rate limit, returned the role and the invite id.
- Legacy login stores a synthetic password in `localStorage` in plaintext.
- `supabase/.temp/` was committed despite `.gitignore`; `.env*` was not ignored.
- No migrations, seed file or `.env.example` in the repo; README was the Vite template.
- Smaller: `date_of_birth` only checked for non-empty; `onAuthStateChange` awaited a Supabase call (deadlock risk)
  and the profile was fetched twice on load; a failed profile insert left an orphan auth user;
  `Unauthorized` sent users with no role to `/employee`; `config.toml` `minimum_password_length = 6` vs 8 in the
  client; `/profile` nav link had no route; edge function imports unpinned.
- Second review: invite codes used `Math.random()`; CSV export had no formula-injection guard;
  role-change UI reported success even when RLS filtered the update to zero rows.

## 2. Git housekeeping (commands you ran)
- `git rm -r --cached supabase/.temp` (stop tracking; the folder is still in git history).
- Added `.env` and `.env.*` to `.gitignore`.
- Committed and pushed the missing pages plus `vercel.json`.
- Later: `git rm -r supabase/functions/mark-invite-used`.

## 3. Database (Supabase), migrations in order

### `20260920000000_baseline.sql` (already live; mark as applied, do not run)
Records the schema you had built by hand in the SQL Editor: `profiles`, `invite_codes`, `tasks` with RLS,
the `admin` role (constraints widened), `audit_log`, extra profile columns (`display_role`, `first_name`,
`middle_name`, `last_name`, `date_of_birth`, `date_of_joining`), admin policies on `invite_codes`, and the last
hand-applied "manager read all" policy (which was still recursive and caused the login failure).
Applied on the hosted project with `supabase migration repair --status applied 20260920000000`.

### `20260920000100_security_and_rls_fixes.sql`
- `get_my_role()` (security definer): fixes the "infinite recursion detected in policy for relation profiles" error.
- Policies rewritten to use it: profiles manager-read, tasks manager read/insert/update/delete
  (admin now has manager-level task access; task insert requires `assigned_by = auth.uid()`).
- New `profiles: admin update` policy (admin role changes previously silently did nothing).
- Dropped `profiles: self insert`; profiles are created only by the signup trigger.
- `guard_profile_update` trigger: non-admins cannot change `role`, `is_legacy` or `id`; admins cannot change their own role.
- `guard_task_update` trigger: employees may only change task status.
- `handle_new_user` trigger on `auth.users`: reads signup metadata, validates the invite code atomically
  (`for update`), assigns the role from the invite, marks it used. Bad/used/expired codes abort the signup.
  Users created with no metadata (dashboard "Add user") are skipped and need a profile created by hand.
- Audit log: `write_audit()` trigger function on `profiles` (role changes), `invite_codes`, `tasks`;
  `audit_log.performed_by` now `on delete set null`; audit rows immutable to clients (update/delete/truncate revoked).

### `20260920000200_assigner_names_and_invite_rate_limit.sql`
- `get_task_assigners()` RPC: names-only, so employees can see who assigned their tasks without reading profile rows.
- `invite_attempts` table (service role only) for per-IP rate limiting of failed invite lookups.

### `20260920000300_task_documents.sql`
- `can_access_task()` and `can_access_task_file()` helpers (the latter rejects malformed/traversal paths safely).
- `task_documents` table (immutable; RLS: read/insert/delete; 10 MB check; path must start with the task id).
- Private bucket `task-docs` (10 MB, PDF/Office/PNG/JPEG/text/CSV only) and its `storage.objects` policies.
- Audit trigger for uploads and deletions (filename only).

### `20260920000400_teams.sql`
- `teams`, `team_members`, `tasks.team_id` (`on delete restrict`), constraint: a task has exactly one of a person or a team
  (`not valid`, so old rows are not re-checked).
- `is_team_member()` helper; RLS: managers/admins manage teams; members read their own teams.
- Task policies extended so team members can read and update the status of their team's tasks;
  `guard_task_update` now also locks `team_id` for employees.
- `can_access_task()` extended so team members can submit documents; `get_task_assigners()` extended to team tasks;
  new `get_team_roster()` RPC (names only).
- Audit: `teams`, `team_members`, and team changes on tasks.

### SQL you ran by hand earlier in the session (before migrations)
- Seed invite `MGRINVITE` (manager, 7 days). **Delete it:** `delete from public.invite_codes where code = 'MGRINVITE';`
- Insert of your admin profile (`admin`, id `d5be9294-...`).
- Superseded by the migrations above; nothing else to run.

## 4. Edge functions
- **Deleted** `mark-invite-used` (code removed from the repo; deleted on Supabase with `supabase functions delete mark-invite-used`).
  The signup trigger replaces it.
- **Rewritten** `validate-invite`: `Deno.serve`, `npm:@supabase/supabase-js@2`, POST only, code length cap,
  per-IP rate limit (10 failed lookups per 15 minutes, 429 with `Retry-After`), uses `cf-connecting-ip`,
  fails closed if the rate-limit lookup errors, no longer returns `invite_id`, optional `ALLOWED_ORIGIN` secret for CORS.
  Deployed with `supabase functions deploy validate-invite --use-api` (no Docker needed).
- `supabase/config.toml`: **no change was needed** (`verify_jwt = false` for `validate-invite` already existed).
  I briefly appended a duplicate block, which broke TOML parsing; you reverted it. Still to do by hand:
  delete the leftover `[functions.mark-invite-used]` block at the end of `config.toml`.
- Not added: an "audit log Edge Function". The audit log is written by database triggers, which cannot be bypassed.

## 5. Frontend, file by file

### Bug fixes and hardening
- `src/App.jsx`: removed unused `useAuth` import.
- `src/context/AuthContext.jsx`: profile fetched once via `onAuthStateChange` (INITIAL_SESSION), only when the user
  changes; fetch deferred with `setTimeout` (deadlock avoidance); token refresh/tab focus no longer refetch;
  `RETRY_ATTEMPTS` 5 to 3; `signOut` resets the tracked user; `eslint-disable` on the `useAuth` export.
- `src/components/ProtectedRoute.jsx`: a signed-in user whose profile can't load now sees "Could not load your profile"
  with a sign-out button instead of an endless spinner.
- `src/pages/Unauthorized.jsx`: falls back to `/login` if the role isn't employee/manager/admin.
- `src/pages/Login.jsx`, `src/pages/Signup.jsx`: `error.errors` to `error.issues` (Zod 4).
- `src/pages/Signup.jsx`: removed unused `useEffect`; no more client-side profile insert or `markInviteUsed`;
  profile fields sent as signup metadata; friendlier error mapping (already registered, "Database error");
  handles email-confirmation-on (no session); `rate_limited` message for invite validation; comment updated to `{ valid, role }`.
- `src/pages/AdminPanel.jsx`: removed unused `SUPABASE_URL`; `AuditTab` no longer takes an unused `showToast`;
  role change checks that a row was really updated (`.select('id')`); invite codes use `crypto.getRandomValues`;
  CSV export prefixes cells starting with `= + - @` (formula injection); `eslint-disable` (with reason) on three fetch effects;
  tasks CSV now includes `team_id`.
- `src/pages/ManagerDashboard.jsx`: removed unused `STATUS_OPTIONS`/`STATUS_LABELS`; `SortIcon` component to a `renderSortIcon`
  function; `eslint-disable` on the fetch effect; deleting a task now also removes its files from Storage.
- `src/pages/EmployeeDashboard.jsx`: `SortIcon` to a render function; `eslint-disable` on the fetch effect;
  assigner names via the RPC (`src/lib/assigners.js`).
- `src/pages/TaskDetail.jsx`: assigner fallback via the RPC.

### Login and Signup redesign
- v1 (rejected): split layout, gradient panel, grid lines, headline and marketing copy.
- v2: flat navy left panel with a centered "VT" tile, "Verlyn Tech" and "Company dashboard".
- v3 (current): flat navy plus a faint glowing grid. New `src/components/GridBackdrop.jsx` + `.module.css`
  (grid alpha 0.10, glow alpha 0.22, 56px cells, radial fade). Right-hand login card kept larger (up to 520px) with bigger controls.
- Signup keeps its centered card, now on the same navy/grid page with a logo header above the card, stronger card shadow,
  darker page in dark theme, tighter padding under 560px. Old in-card logo removed.
- Small screens (under 960px): brand panel hidden on login, logo shown above the form.

### Document submission
- `src/lib/documents.js`: validation (10 MB; pdf/doc/docx/xls/xlsx/ppt/pptx/txt/csv/png/jpg/jpeg), filename sanitising,
  upload with cleanup if the row insert fails, 60-second signed download links, delete (row first, then file),
  path helpers for task deletion.
- `src/components/TaskDocuments.jsx` + `.module.css`: "Documents" card on the task page (multi-upload, download, delete).
  Employees see "Manager" as the uploader of manager files (they can't read other profiles).
- `TaskDetail.module.css`: added `.mainCol` (stacks the two cards).

### Teams
- `src/pages/ManagerTeams.jsx` + `.module.css` (route `/manager/teams`): create teams, add/remove members, delete teams
  (blocked while tasks still point at them; friendly error).
- `ManagerDashboard.jsx`: single "Assign to" select with People and Teams groups; a task is saved with either `assigned_to`
  or `team_id`; team name shown (and searchable/sortable) in the table.
- `EmployeeDashboard.jsx`: "My Tasks" now = assigned to me or to a team I'm in (explicit filter so managers don't see everything);
  "Team task · name" label; realtime no longer filters on `assigned_to`.
- `TaskDetail.jsx`: team card with roster; team members can update status.
- `Navbar.jsx`: new "Teams" link; active-link check is now exact-segment so "Team" and "Teams" don't both highlight.

## 6. Repo/CI additions
- `.github/workflows/supabase-keepalive.yml`: pings the REST API every Monday and Thursday so the free-tier project isn't
  auto-paused, and fails (GitHub emails you) if the project is down. Needs repo secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
  Script logic tested against a mock server (200/401 pass; 503, unreachable and missing secrets fail).
- `docs/SESSION_CHANGES.md`: this file.

## 7. What you still need to do
1. Extract the final zip at the repo root.
2. `supabase db push` (applies whichever of `...0300` and `...0400` are not applied yet).
3. Delete the `[functions.mark-invite-used]` block at the end of `supabase/config.toml`.
4. Add the two GitHub secrets for the keep-alive workflow.
5. Delete the `MGRINVITE` invite; remove throwaway test accounts (Authentication, Users).
6. Commit and push.

## 8. Known gaps (not done)
- Legacy login still keeps a plaintext synthetic password in `localStorage`.
- Managers and admins can read `date_of_birth` of everyone.
- `validate-invite` is still unauthenticated and returns the role (rate-limited now).
- No CSP header in `vercel.json`; README is still the Vite template; no `.env.example`.
- No virus scanning of uploads; file type is checked by extension/declared type only.
- Free tier: no automated backups; storage files are not in database backups; project pauses after 7 days idle
  (keep-alive workflow mitigates); GitHub disables scheduled workflows after about 60 days without repo activity.
- `supabase/.temp/` values remain in git history.
- Planned but not started: messaging with group chats. The audit-log edge function was judged unnecessary.
- Employees see one shared list for team tasks; there is no per-member completion tracking.
- Deleting a team with tasks is blocked; the tasks must be reassigned first.
