-- Profiles: editable details, profile photos, and self-service account deletion.

-- ============================================================
-- 1. Profile photo column + private-by-path public bucket
-- ============================================================
alter table public.profiles
  add column avatar_path text
  check (avatar_path is null
         or (avatar_path ~ '^[0-9a-f-]{36}/[^/]+$' and split_part(avatar_path, '/', 1) = id::text));

-- Public bucket: photos are shown by plain URL. Filenames are random, and the paths are only handed out to
-- signed-in users (get_directory). Uploads are resized and re-encoded in the browser (EXIF/GPS is dropped).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "avatars: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and name ~ '^[0-9a-f-]{36}/[^/]+$' and split_part(name, '/', 1) = auth.uid()::text);

-- (the storage API needs select + delete to remove an object)
create policy "avatars: read own" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text);

create policy "avatars: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text);

-- ============================================================
-- 2. What a person may edit about themselves
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

    -- admins can change other people's role and nothing else
    if new.id <> auth.uid()
       and (new.username, new.first_name, new.middle_name, new.last_name, new.date_of_birth, new.avatar_path, new.display_role)
           is distinct from
           (old.username, old.first_name, old.middle_name, old.last_name, old.date_of_birth, old.avatar_path, old.display_role) then
      raise exception 'You can only edit your own details';
    end if;
  end if;

  if (new.first_name, new.middle_name, new.last_name) is distinct from (old.first_name, old.middle_name, old.last_name) then
    new.first_name  := nullif(btrim(new.first_name), '');
    new.middle_name := nullif(btrim(new.middle_name), '');
    new.last_name   := nullif(btrim(new.last_name), '');
    if new.first_name is null or new.last_name is null then
      raise exception 'First and last name are required';
    end if;
    if char_length(new.first_name) > 50 or char_length(coalesce(new.middle_name, '')) > 50 or char_length(new.last_name) > 50 then
      raise exception 'Names can be up to 50 characters each';
    end if;
  end if;

  if new.username is distinct from old.username then
    if old.is_legacy and auth.uid() is not null then
      raise exception 'Usernames of legacy accounts cannot be changed (they are the sign-in name)';
    end if;
    new.username := lower(btrim(new.username));
    if new.username !~ '^[a-z0-9._-]{2,32}$' then
      raise exception 'Usernames are 2 to 32 characters: lowercase letters, numbers, dots, hyphens, underscores';
    end if;
  end if;

  if new.date_of_birth is distinct from old.date_of_birth
     and new.date_of_birth is not null and new.date_of_birth > current_date then
    raise exception 'Date of birth cannot be in the future';
  end if;

  return new;
end $$;

-- ============================================================
-- 3. Names + photos for the people pickers / message authors
-- ============================================================
drop function if exists public.get_directory();
create function public.get_directory()
returns table (id uuid, first_name text, last_name text, role text, avatar_path text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.first_name, p.last_name, p.role, p.avatar_path from public.profiles p
  where auth.uid() is not null
  order by p.first_name, p.last_name
$$;

drop function if exists public.get_channel_members(uuid);
create function public.get_channel_members(p_channel uuid)
returns table (id uuid, first_name text, last_name text, role text, avatar_path text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.first_name, p.last_name, m.role, p.avatar_path
  from public.channel_members m join public.profiles p on p.id = m.user_id
  where m.channel_id = p_channel and public.can_read_channel(p_channel)
  order by (m.role = 'owner') desc, p.first_name, p.last_name
$$;

revoke all on function public.get_directory(), public.get_channel_members(uuid) from public, anon;
grant execute on function public.get_directory(), public.get_channel_members(uuid) to authenticated;

-- ============================================================
-- 4. Account deletion
--    Kept: messages (shown as "Former user"), uploaded documents, audit entries (without the actor).
--    Removed: the profile, sign-in, team and channel memberships; the profile photo is removed by the app first.
--    Blocked while: the person has open tasks assigned to them, or is the only admin.
-- ============================================================
-- Referencing rows go to NULL instead of blocking the deletion.
alter table public.tasks drop constraint tasks_assigned_to_fkey,
  add constraint tasks_assigned_to_fkey foreign key (assigned_to) references public.profiles(id) on delete set null;
alter table public.tasks drop constraint tasks_assigned_by_fkey,
  add constraint tasks_assigned_by_fkey foreign key (assigned_by) references public.profiles(id) on delete set null;
alter table public.invite_codes drop constraint invite_codes_created_by_fkey,
  add constraint invite_codes_created_by_fkey foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.invite_codes drop constraint invite_codes_used_by_fkey,
  add constraint invite_codes_used_by_fkey foreign key (used_by) references public.profiles(id) on delete set null;

-- A finished task may outlive its assignee.
alter table public.tasks drop constraint tasks_one_assignee_check,
  add constraint tasks_one_assignee_check check (num_nonnulls(assigned_to, team_id) = 1 or status = 'done') not valid;

create or replace function public.guard_profile_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_open int;
begin
  select count(*) into v_open from public.tasks where assigned_to = old.id and status <> 'done';
  if v_open > 0 then
    raise exception 'This account still has % open task(s) assigned. Reassign them first.', v_open;
  end if;
  if old.role = 'admin' and not exists (select 1 from public.profiles where role = 'admin' and id <> old.id) then
    raise exception 'This is the only admin account. Make someone else an admin first.';
  end if;
  return old;
end $$;

drop trigger if exists guard_profile_delete on public.profiles;
create trigger guard_profile_delete before delete on public.profiles
for each row execute function public.guard_profile_delete();

-- null = the account can be deleted; otherwise the reason, in plain words
create or replace function public.check_account_deletion()
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_me   uuid := auth.uid();
  v_role text;
  v_open int;
begin
  if v_me is null then return 'Not signed in.'; end if;
  select role into v_role from public.profiles where id = v_me;
  if v_role is null then return 'Profile not found.'; end if;

  select count(*) into v_open from public.tasks where assigned_to = v_me and status <> 'done';
  if v_open > 0 then
    return format('You still have %s open %s assigned to you. Ask a manager to reassign or complete %s first.',
                  v_open, case when v_open = 1 then 'task' else 'tasks' end, case when v_open = 1 then 'it' else 'them' end);
  end if;

  if v_role = 'admin' and not exists (select 1 from public.profiles where role = 'admin' and id <> v_me) then
    return 'You are the only admin. Make someone else an admin before deleting your account.';
  end if;

  return null;
end $$;

create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me  uuid := auth.uid();
  v_msg text;
  r     record;
begin
  v_msg := public.check_account_deletion();
  if v_msg is not null then raise exception '%', v_msg; end if;

  -- leave group chats properly so none is left without an owner (an empty group is archived)
  for r in
    select m.channel_id from public.channel_members m
    join public.channels c on c.id = m.channel_id
    where m.user_id = v_me and c.type = 'private'
  loop
    perform public.remove_channel_member(r.channel_id, v_me);
  end loop;

  delete from auth.users where id = v_me;   -- cascades to the profile, sessions, memberships
end $$;

revoke all on function public.check_account_deletion(), public.delete_my_account() from public, anon;
grant execute on function public.check_account_deletion(), public.delete_my_account() to authenticated;

-- ============================================================
-- 5. Guards and audit made safe for the cascade above
-- ============================================================
create or replace function public.guard_task_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- referential actions (e.g. a deleted account's rows going to NULL) run inside another trigger
  if pg_trigger_depth() > 1 then return new; end if;
  if auth.uid() is not null and public.get_my_role() = 'employee' then
    if (new.title, new.description, new.assigned_to, new.team_id, new.assigned_by, new.deadline, new.created_at)
       is distinct from
       (old.title, old.description, old.assigned_to, old.team_id, old.assigned_by, old.deadline, old.created_at) then
      raise exception 'Employees can only change task status';
    end if;
  end if;
  return new;
end $$;

create or replace function public.guard_document_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- referential actions (e.g. a deleted account's rows going to NULL) run inside another trigger
  if pg_trigger_depth() > 1 then return new; end if;
  -- the file itself never changes
  if (new.task_id, new.uploaded_by, new.storage_path, new.filename, new.size_bytes, new.mime_type, new.created_at)
     is distinct from
     (old.task_id, old.uploaded_by, old.storage_path, old.filename, old.size_bytes, old.mime_type, old.created_at) then
    raise exception 'Document details cannot be changed';
  end if;

  -- strip HTML tags from the note (stored-XSS hygiene), trim, empty -> null
  if new.reviewer_note is not null then
    new.reviewer_note := nullif(btrim(regexp_replace(new.reviewer_note, '<[^>]*>', '', 'g')), '');
  end if;

  if auth.uid() is not null then
    if old.status = 'accepted' then
      raise exception 'Accepted documents can no longer be reviewed';
    end if;
    -- acceptance (and the Drive fields) only come from the push-to-drive function
    if new.status = 'accepted'
       or (new.drive_file_id, new.drive_file_url, new.drive_folder)
          is distinct from (old.drive_file_id, old.drive_file_url, old.drive_folder) then
      raise exception 'Documents are accepted by pushing them to Drive';
    end if;

    if new.status = 'rejected' then
      if new.reviewer_note is null then
        raise exception 'A note is required when rejecting a document';
      end if;
      new.reviewed_by := auth.uid();   -- set here, never trusted from the client
      new.reviewed_at := now();
    else                                -- back to pending review: clear the review
      new.reviewer_note := null;
      new.reviewed_by   := null;
      new.reviewed_at   := null;
    end if;
  end if;

  return new;
end $$;

create or replace function public.guard_channel_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- referential actions (e.g. a deleted account's rows going to NULL) run inside another trigger
  if pg_trigger_depth() > 1 then return new; end if;
  if (new.name, new.type, new.dm_key, new.created_by, new.created_at)
     is distinct from (old.name, old.type, old.dm_key, old.created_by, old.created_at) then
    raise exception 'A channel''s name, type and owner cannot be changed';
  end if;
  if old.type = 'direct' then
    raise exception 'Direct messages cannot be edited';
  end if;
  return new;
end $$;

create or replace function public.guard_message_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- referential actions (e.g. a deleted account's rows going to NULL) run inside another trigger
  if pg_trigger_depth() > 1 then return new; end if;
  if (new.channel_id, new.sender_id, new.created_at) is distinct from (old.channel_id, old.sender_id, old.created_at) then
    raise exception 'Messages cannot be moved or re-attributed';
  end if;

  if old.deleted_at is not null then
    raise exception 'A deleted message cannot be changed';
  end if;

  if new.deleted_at is not null then
    new.body := '';                       -- deleting really removes the text
    new.edited_at := old.edited_at;
    return new;
  end if;

  if new.body is distinct from old.body then
    if old.sender_id is distinct from auth.uid() then
      raise exception 'Only the sender can edit a message';
    end if;
    new.edited_at := now();
  end if;
  return new;
end $$;

create or replace function public.write_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_delta jsonb;
  v_actor uuid := auth.uid();
begin
  -- during an account deletion the actor's profile is already gone; a dangling reference would fail the insert
  if v_actor is not null and not exists (select 1 from public.profiles where id = v_actor) then
    v_actor := null;
  end if;

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
      if new.used_by is distinct from old.used_by and new.used_by is not null then
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
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
      -- accepts come from the push-to-drive function (service role, no auth.uid()), so fall back to reviewed_by
      v_actor := coalesce(auth.uid(), new.reviewed_by);
      v_delta := jsonb_build_object('task_id', new.task_id, 'filename', new.filename,
        'status_from', old.status, 'status_to', new.status, 'drive_folder', new.drive_folder);
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

  elsif tg_table_name = 'channels' then
    v_id := coalesce(new.id, old.id);
    -- private groups and DMs are not audited: who talks to whom is nobody's business
    if coalesce(new.type, old.type) <> 'public' then return coalesce(new, old); end if;
    v_delta := case when tg_op = 'UPDATE'
                    then jsonb_build_object('name', new.name, 'type_from', old.type, 'type_to', new.type)
                    else jsonb_build_object('name', coalesce(new.name, old.name), 'type', coalesce(new.type, old.type)) end;
  end if;

  insert into public.audit_log (action, entity, entity_id, performed_by, delta)
  values (lower(tg_op), tg_table_name, v_id, v_actor, v_delta);

  return coalesce(new, old);
end $$;
