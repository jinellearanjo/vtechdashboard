-- 1. Let employees see who assigned their tasks, without exposing other profile columns
--    (employees can only read their own profiles row; managers'/admins' rows contain date_of_birth).
create or replace function public.get_task_assigners()
returns table (id uuid, first_name text, last_name text)
language sql stable security definer
set search_path = ''
as $$
  select distinct p.id, p.first_name, p.last_name
  from public.tasks t
  join public.profiles p on p.id = t.assigned_by
  where t.assigned_to = auth.uid()
$$;

revoke all on function public.get_task_assigners() from public, anon;
grant execute on function public.get_task_assigners() to authenticated;

-- 2. Failed invite-code lookups, used by the validate-invite edge function to rate-limit per IP.
--    Service role only: RLS is on with no policies, and client roles have no grants.
create table if not exists public.invite_attempts (
  id         bigint generated always as identity primary key,
  ip         text        not null,
  created_at timestamptz not null default now()
);

create index if not exists invite_attempts_ip_created_idx
  on public.invite_attempts (ip, created_at desc);

alter table public.invite_attempts enable row level security;
revoke all on public.invite_attempts from anon, authenticated;
