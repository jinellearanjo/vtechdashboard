-- Team assignments: tasks can be assigned to a team instead of a single person.
-- Any member of the team can see the task, change its status and submit documents.

-- ============================================================
-- 1. Tables
-- ============================================================
create table public.teams (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null unique check (char_length(name) between 1 and 60),
  created_by  uuid        references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table public.team_members (
  team_id   uuid        not null references public.teams(id) on delete cascade,
  user_id   uuid        not null references public.profiles(id) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index team_members_user_idx on public.team_members (user_id);

-- A task is assigned to exactly one of: a person or a team.
-- A team can't be deleted while tasks still point at it (restrict), so no task loses its assignee.
alter table public.tasks
  add column team_id uuid references public.teams(id) on delete restrict;

alter table public.tasks
  add constraint tasks_one_assignee_check
  check (num_nonnulls(assigned_to, team_id) = 1) not valid;  -- not valid: don't re-check old rows

create index tasks_team_idx on public.tasks (team_id);

-- ============================================================
-- 2. Membership helper (security definer: avoids RLS recursion between tasks/teams/team_members)
-- ============================================================
create or replace function public.is_team_member(p_team_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members m
    where m.team_id = p_team_id and m.user_id = auth.uid()
  )
$$;

revoke all on function public.is_team_member(uuid) from public, anon;
grant execute on function public.is_team_member(uuid) to authenticated;

-- ============================================================
-- 3. RLS for teams / team_members
-- ============================================================
alter table public.teams        enable row level security;
alter table public.team_members enable row level security;
revoke all on public.teams, public.team_members from anon;

create policy "teams: read" on public.teams for select
  using (public.get_my_role() in ('manager', 'admin') or public.is_team_member(id));

create policy "teams: manage insert" on public.teams for insert
  with check (public.get_my_role() in ('manager', 'admin') and created_by = auth.uid());

create policy "teams: manage update" on public.teams for update
  using (public.get_my_role() in ('manager', 'admin'))
  with check (public.get_my_role() in ('manager', 'admin'));

create policy "teams: manage delete" on public.teams for delete
  using (public.get_my_role() in ('manager', 'admin'));

-- members can see who is in their own teams' rows; managers see everything
create policy "team_members: read" on public.team_members for select
  using (public.get_my_role() in ('manager', 'admin') or user_id = auth.uid());

create policy "team_members: manage insert" on public.team_members for insert
  with check (public.get_my_role() in ('manager', 'admin'));

create policy "team_members: manage delete" on public.team_members for delete
  using (public.get_my_role() in ('manager', 'admin'));

-- ============================================================
-- 4. Tasks: team members can read and update (status only) their team's tasks
-- ============================================================
drop policy if exists "tasks: employee read own" on public.tasks;
create policy "tasks: employee read own" on public.tasks for select
  using (assigned_to = auth.uid() or public.is_team_member(team_id));

drop policy if exists "tasks: employee update own status" on public.tasks;
create policy "tasks: employee update own status" on public.tasks for update
  using (assigned_to = auth.uid() or public.is_team_member(team_id))
  with check (assigned_to = auth.uid() or public.is_team_member(team_id));

-- employees may only change status: team_id joins the locked columns
create or replace function public.guard_task_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and public.get_my_role() = 'employee' then
    if (new.title, new.description, new.assigned_to, new.team_id, new.assigned_by, new.deadline, new.created_at)
       is distinct from
       (old.title, old.description, old.assigned_to, old.team_id, old.assigned_by, old.deadline, old.created_at) then
      raise exception 'Employees can only change task status';
    end if;
  end if;
  return new;
end $$;

-- ============================================================
-- 5. Documents follow the task: team members can submit to team tasks
-- ============================================================
create or replace function public.can_access_task(p_task_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and (t.assigned_to = auth.uid()
           or public.is_team_member(t.team_id)
           or public.get_my_role() in ('manager', 'admin'))
  )
$$;

-- ============================================================
-- 6. Names-only RPCs (employees can't read other people's profile rows)
-- ============================================================
-- Assigners of every task the caller can see as an assignee OR team member.
create or replace function public.get_task_assigners()
returns table (id uuid, first_name text, last_name text)
language sql stable security definer
set search_path = ''
as $$
  select distinct p.id, p.first_name, p.last_name
  from public.tasks t
  join public.profiles p on p.id = t.assigned_by
  where t.assigned_to = auth.uid() or public.is_team_member(t.team_id)
$$;

-- Roster of a team, for its members and for managers/admins.
create or replace function public.get_team_roster(p_team_id uuid)
returns table (id uuid, first_name text, last_name text)
language sql stable security definer
set search_path = ''
as $$
  select p.id, p.first_name, p.last_name
  from public.team_members m
  join public.profiles p on p.id = m.user_id
  where m.team_id = p_team_id
    and (public.is_team_member(p_team_id) or public.get_my_role() in ('manager', 'admin'))
  order by p.last_name, p.first_name
$$;

revoke all on function public.get_team_roster(uuid) from public, anon;
grant execute on function public.get_team_roster(uuid) to authenticated;

-- ============================================================
-- 7. Audit log: teams, membership changes, and team assignment on tasks
-- ============================================================
create or replace function public.write_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_delta jsonb;
begin
  if tg_table_name = 'profiles' then
    -- only role changes are interesting
    if tg_op = 'UPDATE' and new.role is not distinct from old.role then return new; end if;
    v_id := coalesce(new.id, old.id);
    v_delta := case when tg_op = 'UPDATE'
                    then jsonb_build_object('username', new.username, 'role_from', old.role, 'role_to', new.role)
                    when tg_op = 'INSERT'
                    then jsonb_build_object('username', new.username, 'role', new.role)
                    else jsonb_build_object('username', old.username, 'role', old.role) end;

  elsif tg_table_name = 'invite_codes' then
    v_id := coalesce(new.id, old.id);
    if tg_op = 'UPDATE' then
      if new.used_by is distinct from old.used_by then
        v_delta := jsonb_build_object('event', 'redeemed', 'role', new.role, 'used_by', new.used_by);
      elsif new.expires_at is distinct from old.expires_at then
        v_delta := jsonb_build_object('event', 'expiry_changed', 'role', new.role, 'expires_at', new.expires_at);
      else return new; end if;
    elsif tg_op = 'INSERT' then
      v_delta := jsonb_build_object('role', new.role, 'single_use', new.single_use, 'expires_at', new.expires_at);
    else
      v_delta := jsonb_build_object('role', old.role);
    end if;

  elsif tg_table_name = 'tasks' then
    v_id := coalesce(new.id, old.id);
    if tg_op = 'UPDATE' then
      if new.status is distinct from old.status
         or new.assigned_to is distinct from old.assigned_to
         or new.team_id is distinct from old.team_id
         or new.deadline is distinct from old.deadline then
        v_delta := jsonb_build_object('title', new.title,
          'status_from', old.status, 'status_to', new.status,
          'assigned_to_from', old.assigned_to, 'assigned_to_to', new.assigned_to,
          'team_from', old.team_id, 'team_to', new.team_id);
      else return new; end if;
    elsif tg_op = 'INSERT' then
      v_delta := jsonb_build_object('title', new.title, 'assigned_to', new.assigned_to, 'team_id', new.team_id);
    else
      v_delta := jsonb_build_object('title', old.title);
    end if;

  elsif tg_table_name = 'task_documents' then
    v_id := coalesce(new.id, old.id);
    if tg_op = 'INSERT' then
      v_delta := jsonb_build_object('task_id', new.task_id, 'filename', new.filename, 'size_bytes', new.size_bytes);
    elsif tg_op = 'DELETE' then
      v_delta := jsonb_build_object('task_id', old.task_id, 'filename', old.filename);
    else
      return new;
    end if;

  elsif tg_table_name = 'teams' then
    v_id := coalesce(new.id, old.id);
    v_delta := case when tg_op = 'UPDATE' then jsonb_build_object('name_from', old.name, 'name_to', new.name)
                    when tg_op = 'INSERT' then jsonb_build_object('name', new.name)
                    else jsonb_build_object('name', old.name) end;

  elsif tg_table_name = 'team_members' then
    -- entity_id is the team; the delta says who
    v_id := coalesce(new.team_id, old.team_id);
    v_delta := jsonb_build_object('user_id', coalesce(new.user_id, old.user_id));
  end if;

  insert into public.audit_log (action, entity, entity_id, performed_by, delta)
  values (lower(tg_op), tg_table_name, v_id, auth.uid(), v_delta);

  return coalesce(new, old);
end $$;

drop trigger if exists audit_teams on public.teams;
create trigger audit_teams after insert or update or delete on public.teams
for each row execute function public.write_audit();

drop trigger if exists audit_team_members on public.team_members;
create trigger audit_team_members after insert or delete on public.team_members
for each row execute function public.write_audit();
