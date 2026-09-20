-- Fixes: RLS recursion, admin access, privilege-escalation holes, server-side signup, audit log.
-- Apply with: supabase db push

-- ============================================================
-- 1. Non-recursive role lookup (security definer bypasses RLS)
-- ============================================================
create or replace function public.get_my_role()
returns text
language sql stable security definer
set search_path = ''
as $$ select role from public.profiles where id = auth.uid() $$;

revoke all on function public.get_my_role() from public, anon;
grant execute on function public.get_my_role() to authenticated;

-- ============================================================
-- 2. profiles policies
-- ============================================================
drop policy if exists "profiles: manager read all" on public.profiles;
create policy "profiles: manager read all" on public.profiles for select
  using (public.get_my_role() in ('manager', 'admin'));

drop policy if exists "profiles: admin update" on public.profiles;
create policy "profiles: admin update" on public.profiles for update
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');

-- Profiles are now created by the handle_new_user trigger (section 5), never by clients.
drop policy if exists "profiles: self insert" on public.profiles;

-- ============================================================
-- 3. tasks policies (admin gets manager-level access)
-- ============================================================
drop policy if exists "tasks: manager read all"   on public.tasks;
drop policy if exists "tasks: manager insert"     on public.tasks;
drop policy if exists "tasks: manager update all" on public.tasks;
drop policy if exists "tasks: manager delete"     on public.tasks;

create policy "tasks: manager read all" on public.tasks for select
  using (public.get_my_role() in ('manager', 'admin'));

create policy "tasks: manager insert" on public.tasks for insert
  with check (public.get_my_role() in ('manager', 'admin') and assigned_by = auth.uid());

create policy "tasks: manager update all" on public.tasks for update
  using (public.get_my_role() in ('manager', 'admin'))
  with check (public.get_my_role() in ('manager', 'admin'));

create policy "tasks: manager delete" on public.tasks for delete
  using (public.get_my_role() in ('manager', 'admin'));

-- ============================================================
-- 4. Guard triggers (RLS can't restrict columns)
--    auth.uid() is null for the SQL editor / service role, which stays unrestricted.
-- ============================================================
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    if public.get_my_role() is distinct from 'admin' then
      if new.role is distinct from old.role
         or new.is_legacy is distinct from old.is_legacy
         or new.id is distinct from old.id then
        raise exception 'Not allowed to change role, legacy flag or id';
      end if;
    elsif new.id = auth.uid() and new.role is distinct from old.role then
      raise exception 'Admins cannot change their own role';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update before update on public.profiles
for each row execute function public.guard_profile_update();

create or replace function public.guard_task_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and public.get_my_role() = 'employee' then
    if (new.title, new.description, new.assigned_to, new.assigned_by, new.deadline, new.created_at)
       is distinct from
       (old.title, old.description, old.assigned_to, old.assigned_by, old.deadline, old.created_at) then
      raise exception 'Employees can only change task status';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_task_update on public.tasks;
create trigger guard_task_update before update on public.tasks
for each row execute function public.guard_task_update();

-- ============================================================
-- 5. Server-side signup: role comes from the invite code, redeemed atomically
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  m      jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_code text  := upper(trim(coalesce(m->>'invite_code', '')));
  v_role text  := 'employee';
  inv    public.invite_codes%rowtype;
begin
  -- Users created without sign-up metadata (Supabase dashboard, auth.admin.createUser) get no
  -- profile automatically; create theirs by hand.
  if nullif(m->>'username', '') is null then
    return new;
  end if;

  if v_code <> '' then
    select * into inv from public.invite_codes
     where code = v_code
       and (expires_at is null or expires_at > now())
       and (not single_use or used_by is null)
     for update;
    if not found then
      raise exception 'invalid_invite';
    end if;
    v_role := inv.role;
  end if;

  insert into public.profiles
    (id, username, first_name, middle_name, last_name, date_of_birth, role, is_legacy)
  values
    (new.id, lower(m->>'username'), m->>'first_name', nullif(m->>'middle_name', ''),
     m->>'last_name', nullif(m->>'date_of_birth', '')::date, v_role,
     coalesce((m->>'is_legacy')::boolean, false));

  if v_code <> '' then
    update public.invite_codes set used_by = new.id, used_at = now() where id = inv.id;
  end if;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ============================================================
-- 6. Audit log: written only by triggers (no client insert policy)
--    action = insert | update | delete (matches the admin panel's badge styles)
-- ============================================================
alter table public.audit_log drop constraint if exists audit_log_performed_by_fkey;
alter table public.audit_log
  add constraint audit_log_performed_by_fkey
  foreign key (performed_by) references public.profiles(id) on delete set null;

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
         or new.deadline is distinct from old.deadline then
        v_delta := jsonb_build_object('title', new.title,
          'status_from', old.status, 'status_to', new.status,
          'assigned_to_from', old.assigned_to, 'assigned_to_to', new.assigned_to);
      else return new; end if;
    elsif tg_op = 'INSERT' then
      v_delta := jsonb_build_object('title', new.title, 'assigned_to', new.assigned_to);
    else
      v_delta := jsonb_build_object('title', old.title);
    end if;
  end if;

  insert into public.audit_log (action, entity, entity_id, performed_by, delta)
  values (lower(tg_op), tg_table_name, v_id, auth.uid(), v_delta);

  return coalesce(new, old);
end $$;

drop trigger if exists audit_profiles on public.profiles;
create trigger audit_profiles after insert or update or delete on public.profiles
for each row execute function public.write_audit();

drop trigger if exists audit_invite_codes on public.invite_codes;
create trigger audit_invite_codes after insert or update or delete on public.invite_codes
for each row execute function public.write_audit();

drop trigger if exists audit_tasks on public.tasks;
create trigger audit_tasks after insert or update or delete on public.tasks
for each row execute function public.write_audit();

-- Audit rows must be immutable: no update/delete policy exists, and revoke the grants too.
revoke update, delete, truncate on public.audit_log from anon, authenticated;
