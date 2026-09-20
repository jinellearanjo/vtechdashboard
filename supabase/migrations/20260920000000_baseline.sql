-- BASELINE: schema that was originally applied by hand in the Supabase SQL Editor.
-- Already live on the hosted project. Mark it as applied there instead of running it:
--   supabase migration repair --status applied 20260920000000
-- It exists so a fresh project / local `supabase db reset` can rebuild the same schema.
-- (The final "manager read all" policy below is still recursive; the next migration replaces it.)

-- 1. PROFILES
create table public.profiles (
  id          uuid        primary key references auth.users(id) on delete cascade,
  username    text        unique not null,
  role        text        not null check (role in ('manager', 'employee')),
  is_legacy   boolean     not null default false,
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: own read" on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: manager read all" on public.profiles for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'manager'));

create policy "profiles: self insert" on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles: self update" on public.profiles for update
  using (auth.uid() = id);

-- 2. INVITE CODES
create table public.invite_codes (
  id          uuid        primary key default gen_random_uuid(),
  code        text        unique not null,
  role        text        not null check (role in ('manager', 'employee')),
  created_by  uuid        references public.profiles(id),
  used_by     uuid        references public.profiles(id),
  used_at     timestamptz,
  expires_at  timestamptz,
  single_use  boolean     not null default true,
  created_at  timestamptz not null default now()
);

alter table public.invite_codes enable row level security;

-- 3. TASKS
create table public.tasks (
  id            uuid        primary key default gen_random_uuid(),
  title         text        not null,
  description   text,
  assigned_to   uuid        references public.profiles(id),
  assigned_by   uuid        references public.profiles(id),
  status        text        not null default 'pending'
                            check (status in ('pending', 'in_progress', 'done')),
  deadline      date,
  created_at    timestamptz not null default now()
);

alter table public.tasks enable row level security;

create policy "tasks: employee read own" on public.tasks for select
  using (assigned_to = auth.uid());

create policy "tasks: manager read all" on public.tasks for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'manager'));

create policy "tasks: manager insert" on public.tasks for insert
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'manager'));

create policy "tasks: manager update all" on public.tasks for update
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'manager'));

create policy "tasks: employee update own status" on public.tasks for update
  using (assigned_to = auth.uid())
  with check (assigned_to = auth.uid());

create policy "tasks: manager delete" on public.tasks for delete
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'manager'));

-- 4. ADMIN ROLE, AUDIT LOG, EXTRA PROFILE COLUMNS
alter table public.profiles
  drop constraint profiles_role_check,
  add constraint profiles_role_check check (role in ('manager', 'employee', 'admin'));

alter table public.invite_codes
  drop constraint invite_codes_role_check,
  add constraint invite_codes_role_check check (role in ('manager', 'employee', 'admin'));

create table public.audit_log (
  id           uuid        primary key default gen_random_uuid(),
  action       text        not null,
  entity       text        not null,
  entity_id    uuid,
  performed_by uuid        references public.profiles(id),
  delta        jsonb,
  created_at   timestamptz not null default now()
);

alter table public.audit_log enable row level security;

create policy "audit_log: admin read" on public.audit_log for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

alter table public.profiles
  add column if not exists display_role text;

alter table public.profiles
  add column if not exists first_name      text,
  add column if not exists middle_name     text,
  add column if not exists last_name       text,
  add column if not exists date_of_birth   date,
  add column if not exists date_of_joining date not null default current_date;

-- 5. ADMIN ACCESS TO INVITE CODES
create policy "invite_codes: admin read" on public.invite_codes for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "invite_codes: admin insert" on public.invite_codes for insert
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "invite_codes: admin update" on public.invite_codes for update
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- 6. LAST HAND-APPLIED PATCH (still recursive: it selects from profiles inside a profiles policy)
drop policy if exists "profiles: manager read all" on public.profiles;
create policy "profiles: manager read all" on public.profiles for select
  using ((select role from public.profiles where id = auth.uid()) in ('manager', 'admin'));
