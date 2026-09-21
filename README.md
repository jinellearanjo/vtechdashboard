# Verlyn Tech dashboard

A private, invitation-only company dashboard for a small team: a home page with progress and a deadline calendar,
task management with teams, document submissions that managers review (accepted files are filed to Google Drive),
chat (channels, group chats, direct messages), profiles, and an admin panel.

Built with React 19 + Vite, React Router, Supabase (Postgres with Row Level Security, Auth, Storage, Edge Functions)
and hosted on Vercel.

## Contents
- [Features](#features)
- [Roles](#roles)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Database and migrations](#database-and-migrations)
- [Edge Functions](#edge-functions)
- [Onboarding people](#onboarding-people)
- [Deploying](#deploying)
- [Privacy and security](#privacy-and-security)
- [Free-tier notes](#free-tier-notes)
- [Project structure](#project-structure)
- [More documentation](#more-documentation)
- [Troubleshooting](#troubleshooting)

## Features
| Area | What it does |
|---|---|
| **Home** (`/home`) | Greeting, progress bar, upcoming tasks, and a month calendar with deadline days tinted by urgency. Managers can switch to everyone's tasks. |
| **Tasks** | Managers create and assign tasks to a person or a whole team; contributors update status. |
| **Submissions** | Contributors attach documents to a task; managers accept (file to a Google Drive folder) or reject with a note. |
| **Chat** (`/chat`) | Public channels, invite-only group chats and direct messages, with unread badges and live updates. |
| **Profile** (`/profile`) | Edit details, photo, password; delete your account. |
| **Admin** | Users and roles, invite codes, activity log, CSV export. |

## Roles
| | Contributor (`employee`) | Project Manager (`manager`) | Administrator (`admin`) |
|---|---|---|---|
| See own / team tasks | yes | all tasks | all tasks |
| Create and assign tasks, teams | no | yes | yes |
| Review submissions | no | yes | yes |
| Create public channels, moderate them | no | yes | yes |
| Read other people's group chats and DMs | no | **no** | **no** |
| See other people's date of birth | no | **no** | **no** |
| Manage roles, invites, activity log | no | no | yes |

Legacy accounts (no email, username and password) can only be Contributors.

## Getting started
Requirements: Node 20+, a Supabase project, and the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
npm install
cp .env.example .env.local      # then fill in your project URL and anon key
npm run dev                     # http://localhost:5173
```

Other scripts: `npm run build`, `npm run preview`, `npm run lint`.

## Configuration
Browser (Vite) variables go in `.env.local` locally and in the Vercel project settings when deployed:

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Your project URL |
| `VITE_SUPABASE_ANON_KEY` | The public anon / publishable key (safe to expose; RLS protects the data) |
| `VITE_ALLOW_DEVICE_LOGIN` | Optional. `false` disables the one-time passwordless sign-in for old legacy accounts |

Server secrets (never in the browser) live in Supabase: see [Edge Functions](#edge-functions).
Never commit `.env.local`, service-role keys, or the Google service-account JSON.

## Database and migrations
The schema lives in `supabase/migrations/` and is applied in filename order:

| File | Adds |
|---|---|
| `20260920000000_baseline` | Original tables (profiles, tasks, invite codes, audit log). Already live on the hosted project: mark it applied instead of running it (`supabase migration repair --status applied 20260920000000`). |
| `..000100_security_and_rls_fixes` | Non-recursive role lookup, admin access, guard triggers, server-side sign-up, audit triggers |
| `..000200_assigner_names_and_invite_rate_limit` | Names-only RPC for assigners, invite rate-limit table |
| `..000300_task_documents` | Task documents table, private `task-docs` bucket and its policies |
| `..000400_teams` | Teams, team tasks |
| `..000500_submission_review_and_channels` | Review workflow (accept/reject), channels table |
| `..000600_chat` | Messages, membership, group chats, DMs, unread counts |
| `..000700_profiles_avatars_account_deletion` | Profile edits, photos, self-service account deletion |
| `..000800_signup_legacy_privacy` | Invite-only sign-up, profile-less lockout, legacy cap, private date of birth |

Apply new migrations to the linked project (no Docker needed):

```bash
supabase link --project-ref YOUR-PROJECT-REF
supabase db push
```

`supabase db pull` and local `supabase start` need Docker; the workflow above does not.

## Edge Functions
| Function | Purpose | Deploy |
|---|---|---|
| `validate-invite` | Checks an invite code on the sign-up form (rate-limited per IP). `verify_jwt = false` because it runs before sign-in. | `supabase functions deploy validate-invite --use-api` |
| `push-to-drive` | Copies an accepted submission to Google Drive. Manager/admin only. | `supabase functions deploy push-to-drive --use-api` |

Drive setup, secrets and troubleshooting: [`docs/DRIVE_SETUP.md`](docs/DRIVE_SETUP.md). A template for the secrets is in
`supabase/.env.drive.example`.

## Onboarding people
Sign-up is **by invitation only**:
1. Sign in as an administrator, open **Admin > Invites**, and create a code (Contributor, Manager or Admin).
2. Give the person the code. They open the sign-up page and enter it. Codes are single-use and can expire.

The requirement is a setting in the database (`app_settings.signup_requires_invite`). To switch it off or on, run in the
Supabase SQL editor:

```sql
update public.app_settings set value = 'false' where key = 'signup_requires_invite';  -- open sign-up
update public.app_settings set value = 'true'  where key = 'signup_requires_invite';  -- invite-only (default)
```

**Legacy accounts** are for people without an email address: they sign in with a username and password. Older legacy
accounts were passwordless; they sign in once from the browser that remembers them and are asked to set a password.
To find legacy accounts that hold a manager/admin role (no longer allowed): 
`select username, role from public.profiles where is_legacy and role <> 'employee';`

## Deploying
1. Create the Vercel project from this repository and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
2. `vercel.json` provides the SPA rewrite and security headers. The Content-Security-Policy has two parts: a small policy
   that is enforced, and a full policy in `Content-Security-Policy-Report-Only`. To promote the full policy: open the
   deployed site, use every page (sign in, chat, upload a document, profile photo), and check the browser console for
   "Content Security Policy" violations. If there are none, rename the header key to `Content-Security-Policy` (and drop the
   small one). If you move to a different Supabase project, update the project host in `vercel.json`.
3. Keep-alive: `.github/workflows/supabase-keepalive.yml` pings the project twice a week so the free tier doesn't pause it.
   Add repository secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

## Privacy and security
- Row Level Security is on for every table; access rules live in the migrations, not the client.
- Group chats and DMs can be read only by their members. Date of birth can be read only by its owner.
- Uploaded files sit in private buckets (`task-docs`); profile photos are in a public-by-URL bucket with random names.
- Users can delete their own account (`/profile`). What is kept and removed is described in `/privacy`
  (`src/pages/Privacy.jsx`); keep that page in sync with the behaviour if you change it.
- Sign-up requires an invite; a signed-in user without a profile can read nothing.

## Free-tier notes
The Supabase free plan pauses a project after 7 days without activity (the keep-alive workflow prevents that), has no
automated backups, and includes 1 GB of file storage. Export your data periodically, or move to a paid plan if the team
depends on this.

## Project structure
```
src/
  components/      Navbar, Avatar, Modal, MonthCalendar, TaskDocuments, chat/ (sidebar, thread, members, dialogs)
  context/         AuthContext (session, profile, role)
  lib/             supabase client, chat, documents, avatars, profile, tasks, calendar, legacy helpers
  pages/           Home, Chat, Profile, Login, Signup, Terms, Privacy, Employee/Manager/Admin dashboards, TaskDetail
  styles/          tokens.css (all colours and spacing; no hardcoded values elsewhere)
supabase/
  migrations/      schema, RLS policies, triggers and functions
  functions/       validate-invite, push-to-drive (Deno)
docs/              DRIVE_SETUP.md, SESSION_CHANGES.md, apps-script/Code.gs
.github/workflows/ keep-alive
```

## More documentation
- [`docs/DRIVE_SETUP.md`](docs/DRIVE_SETUP.md): Google Drive filing setup
- [`docs/SESSION_CHANGES.md`](docs/SESSION_CHANGES.md): detailed change log of the security, feature and design work

## Troubleshooting
| Symptom | Likely cause |
|---|---|
| "infinite recursion detected in policy" | A policy reads its own table. Use the `get_my_role()` / helper functions from the migrations. |
| Blank spinner after sign-in | The account has no profile row. Create one, or check the sign-up trigger. |
| Sign-up says "invite code required" | Expected: create a code in Admin > Invites. |
| Drive push errors | See the troubleshooting table in `docs/DRIVE_SETUP.md`. |
| `supabase db pull` fails with "docker: command not found" | It needs Docker. Use `supabase db push` with migration files instead. |
