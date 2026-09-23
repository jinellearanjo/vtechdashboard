-- Departments (restricted channels people request access to) and chat extras (attachments, search).
--
-- Channel kinds after this migration:
--   open        a public channel everyone is in (new: "General")
--   department  a public channel only approved people (and admins) can see; up to 3 per person
--   private     invite-only group chat        direct   a DM between two people

-- ============================================================
-- 1. Channel access kind; the seven existing channels become departments; add General
-- ============================================================
alter table public.channels
  add column access text not null default 'open' check (access in ('open', 'department'));

alter table public.channels disable trigger audit_channels;   -- keep this reshuffle out of the audit log
update public.channels set access = 'department' where type = 'public';
alter table public.channels enable trigger audit_channels;

-- ============================================================
-- 2. Who gets auto-joined
-- ============================================================
create or replace function public.join_new_public_channel()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.type = 'public' and new.access = 'open' then
    -- everyone is in an open channel
    insert into public.channel_members (channel_id, user_id, role)
    select new.id, p.id, case when p.id = new.created_by then 'owner' else 'member' end
    from public.profiles p
    on conflict do nothing;
  elsif new.type = 'public' and new.access = 'department' then
    -- only administrators are in a department until others are approved
    insert into public.channel_members (channel_id, user_id, role)
    select new.id, p.id, case when p.id = new.created_by then 'owner' else 'member' end
    from public.profiles p where p.role = 'admin'
    on conflict do nothing;
  end if;
  return new;
end $$;

create or replace function public.join_public_channels_for_new_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.channel_members (channel_id, user_id)
  select c.id, new.id from public.channels c where c.type = 'public' and c.access = 'open'
  on conflict do nothing;
  return new;
end $$;

-- ============================================================
-- 3. department_access: requests and grants
-- ============================================================
create table public.department_access (
  user_id      uuid        not null references public.profiles(id) on delete cascade,
  channel_id   uuid        not null references public.channels(id) on delete cascade,
  status       text        not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  requested_at timestamptz not null default now(),
  decided_by   uuid        references public.profiles(id) on delete set null,
  decided_at   timestamptz,
  primary key (user_id, channel_id)
);

create index department_access_pending_idx on public.department_access (requested_at) where status = 'pending';

alter table public.department_access enable row level security;
revoke all on public.department_access from anon;
revoke insert, update, delete on public.department_access from authenticated;   -- changed through the functions below

create policy "department_access: read" on public.department_access for select
  using (user_id = auth.uid() or public.get_my_role() = 'admin');

-- A department row must point at a department channel, and a person holds at most 3 (pending or approved).
create or replace function public.guard_department_access()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.channels c where c.id = new.channel_id and c.type = 'public' and c.access = 'department') then
    raise exception 'That is not a department';
  end if;

  if new.status in ('pending', 'approved') and (tg_op = 'INSERT' or old.status = 'denied') then
    if (select count(*) from public.department_access a
         where a.user_id = new.user_id and a.status in ('pending', 'approved')
           and a.channel_id <> new.channel_id) >= 3 then
      raise exception 'You can be in up to 3 departments';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_department_access on public.department_access;
create trigger guard_department_access before insert or update on public.department_access
for each row execute function public.guard_department_access();

-- Membership of department channels = approved grants (+ every administrator). Recomputed per person.
create or replace function public.sync_department_membership(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_role text;
begin
  select role into v_role from public.profiles where id = p_user;
  if v_role is null then return; end if;   -- profile is gone (account deletion): memberships cascade anyway

  insert into public.channel_members (channel_id, user_id)
  select c.id, p_user from public.channels c
  where c.type = 'public' and c.access = 'department'
    and (v_role = 'admin' or exists (
          select 1 from public.department_access a
          where a.user_id = p_user and a.channel_id = c.id and a.status = 'approved'))
  on conflict do nothing;

  delete from public.channel_members m using public.channels c
  where m.channel_id = c.id and m.user_id = p_user
    and c.type = 'public' and c.access = 'department'
    and v_role <> 'admin'
    and not exists (select 1 from public.department_access a
                    where a.user_id = p_user and a.channel_id = c.id and a.status = 'approved');
end $$;

create or replace function public.sync_department_membership_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'department_access' then
    perform public.sync_department_membership(coalesce(new.user_id, old.user_id));
  else  -- profiles: a new person, or a role change (becoming / ceasing to be an administrator)
    perform public.sync_department_membership(new.id);
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists sync_department_membership on public.department_access;
create trigger sync_department_membership after insert or update or delete on public.department_access
for each row execute function public.sync_department_membership_trigger();

drop trigger if exists sync_department_membership_role on public.profiles;
create trigger sync_department_membership_role after insert or update of role on public.profiles
for each row execute function public.sync_department_membership_trigger();

-- Reset: department chats now need access. Everyone but administrators starts with none (they will be asked to choose).
delete from public.channel_members m using public.channels c
where m.channel_id = c.id and c.type = 'public' and c.access = 'department';
insert into public.channel_members (channel_id, user_id)
select c.id, p.id from public.channels c cross join public.profiles p
where c.type = 'public' and c.access = 'department' and p.role = 'admin'
on conflict do nothing;

-- ============================================================
-- 4. Access helpers, policies, sidebar function
-- ============================================================
create or replace function public.can_read_channel(p_channel uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_profile() and exists (
    select 1 from public.channels c
    where c.id = p_channel
      and ((c.type = 'public' and c.access = 'open') or public.is_channel_member(c.id)))
$$;

create or replace function public.can_post_channel(p_channel uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_profile() and exists (
    select 1 from public.channels c
    where c.id = p_channel and c.archived_at is null
      and ((c.type = 'public' and c.access = 'open') or public.is_channel_member(c.id)))
$$;

-- managers/admins moderate PUBLIC channels they can read
create or replace function public.can_moderate_channel(p_channel uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.get_my_role() in ('manager', 'admin')
     and exists (select 1 from public.channels c
                 where c.id = p_channel and c.type = 'public'
                   and (c.access = 'open' or public.is_channel_member(c.id)))
$$;

drop policy if exists "channels: read" on public.channels;
create policy "channels: read" on public.channels for select
  using (public.has_profile() and ((type = 'public' and access = 'open') or public.is_channel_member(id)));

-- managers/admins create open channels; only administrators create departments
drop policy if exists "channels: insert public" on public.channels;
create policy "channels: insert public" on public.channels for insert
  with check (public.get_my_role() in ('manager', 'admin') and type = 'public' and created_by = auth.uid()
              and (access = 'open' or public.get_my_role() = 'admin'));

drop policy if exists "channels: update" on public.channels;
create policy "channels: update" on public.channels for update
  using ((public.get_my_role() in ('manager', 'admin') and type = 'public'
          and (access = 'open' or public.is_channel_member(id)))
         or public.is_channel_owner(id))
  with check ((public.get_my_role() in ('manager', 'admin') and type = 'public'
          and (access = 'open' or public.is_channel_member(id)))
         or public.is_channel_owner(id));

create or replace function public.guard_channel_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- referential actions (e.g. a deleted account's rows going to NULL) run inside another trigger
  if pg_trigger_depth() > 1 then return new; end if;
  if (new.name, new.type, new.access, new.dm_key, new.created_by, new.created_at)
     is distinct from (old.name, old.type, old.access, old.dm_key, old.created_by, old.created_at) then
    raise exception 'A channel''s name, type, access and owner cannot be changed';
  end if;
  if old.type = 'direct' then
    raise exception 'Direct messages cannot be edited';
  end if;
  return new;
end $$;

drop function if exists public.get_channel_overview();
create function public.get_channel_overview()
returns table (
  id uuid, name text, title text, description text, type text, access text, archived_at timestamptz, created_by uuid,
  last_message_at timestamptz, unread_count bigint, member_count bigint, my_role text, dm_user_id uuid
)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.title, c.description, c.type, c.access, c.archived_at, c.created_by,
         lm.last_at,
         case when me.user_id is null then 0::bigint else (
           select count(*) from public.messages m
           where m.channel_id = c.id and m.deleted_at is null
             and m.sender_id is distinct from auth.uid() and m.created_at > me.last_read_at
         ) end,
         (select count(*) from public.channel_members x where x.channel_id = c.id),
         me.role,
         case when c.type = 'direct' then (
           select x.user_id from public.channel_members x where x.channel_id = c.id and x.user_id <> auth.uid() limit 1
         ) end
  from public.channels c
  left join public.channel_members me on me.channel_id = c.id and me.user_id = auth.uid()
  left join lateral (
    select max(m.created_at) as last_at from public.messages m where m.channel_id = c.id and m.deleted_at is null
  ) lm on true
  where public.has_profile() and ((c.type = 'public' and c.access = 'open') or me.user_id is not null)
  order by lm.last_at desc nulls last, c.title
$$;
revoke all on function public.get_channel_overview() from public, anon;
grant execute on function public.get_channel_overview() to authenticated;

-- ============================================================
-- 5. Department functions
-- ============================================================
-- Every department with my status (null = not requested). Administrators are in all of them.
create or replace function public.list_departments()
returns table (id uuid, name text, title text, description text, status text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.title, c.description,
         case when public.get_my_role() = 'admin' then 'approved' else a.status end
  from public.channels c
  left join public.department_access a on a.channel_id = c.id and a.user_id = auth.uid()
  where public.has_profile() and c.type = 'public' and c.access = 'department' and c.archived_at is null
  order by c.title
$$;

create or replace function public.request_department_access(p_channels uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_ch uuid;
begin
  if not public.has_profile() then raise exception 'Not signed in'; end if;
  if public.get_my_role() = 'admin' then return; end if;   -- administrators are in every department

  foreach v_ch in array coalesce(p_channels, '{}') loop
    if not exists (select 1 from public.channels c
                   where c.id = v_ch and c.type = 'public' and c.access = 'department' and c.archived_at is null) then
      raise exception 'That department does not exist';
    end if;
    insert into public.department_access (user_id, channel_id) values (auth.uid(), v_ch)
    on conflict (user_id, channel_id) do update
      set status = 'pending', requested_at = now(), decided_by = null, decided_at = null
      where public.department_access.status = 'denied';       -- pending / approved rows are left alone
  end loop;
end $$;

create or replace function public.withdraw_department_access(p_channel uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.department_access where user_id = auth.uid() and channel_id = p_channel
$$;

create or replace function public.decide_department_access(p_user uuid, p_channel uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.get_my_role() is distinct from 'admin' then raise exception 'Only administrators can decide access'; end if;
  update public.department_access
     set status = case when p_approve then 'approved' else 'denied' end, decided_by = auth.uid(), decided_at = now()
   where user_id = p_user and channel_id = p_channel and status = 'pending';
  if not found then raise exception 'There is no pending request to decide'; end if;
end $$;

create or replace function public.grant_department_access(p_user uuid, p_channel uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.get_my_role() is distinct from 'admin' then raise exception 'Only administrators can grant access'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Unknown user'; end if;
  insert into public.department_access (user_id, channel_id, status, decided_by, decided_at)
  values (p_user, p_channel, 'approved', auth.uid(), now())
  on conflict (user_id, channel_id) do update
    set status = 'approved', decided_by = auth.uid(), decided_at = now();
end $$;

create or replace function public.revoke_department_access(p_user uuid, p_channel uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.get_my_role() is distinct from 'admin' then raise exception 'Only administrators can revoke access'; end if;
  delete from public.department_access where user_id = p_user and channel_id = p_channel;
end $$;

revoke all on function public.list_departments(), public.request_department_access(uuid[]),
  public.withdraw_department_access(uuid), public.decide_department_access(uuid, uuid, boolean),
  public.grant_department_access(uuid, uuid), public.revoke_department_access(uuid, uuid) from public, anon;
grant execute on function public.list_departments(), public.request_department_access(uuid[]),
  public.withdraw_department_access(uuid), public.decide_department_access(uuid, uuid, boolean),
  public.grant_department_access(uuid, uuid), public.revoke_department_access(uuid, uuid) to authenticated;

-- ============================================================
-- 6. The extra open chat
-- ============================================================
alter table public.channels disable trigger audit_channels;
insert into public.channels (name, title, description, type, access)
values ('general', 'General', 'Company-wide chat and announcements', 'public', 'open')
on conflict (name) do nothing;
alter table public.channels enable trigger audit_channels;

-- ============================================================
-- 7. Chat attachments
-- ============================================================
alter table public.messages add column has_attachment boolean not null default false;

do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.messages'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%btrim%' loop
    execute format('alter table public.messages drop constraint %I', c);
  end loop;
end $$;
alter table public.messages add constraint messages_body_check
  check (char_length(body) <= 4000 and (deleted_at is not null or has_attachment or char_length(btrim(body)) >= 1));

create or replace function public.guard_message_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- referential actions (e.g. a deleted account's rows going to NULL) run inside another trigger
  if pg_trigger_depth() > 1 then return new; end if;
  if (new.channel_id, new.sender_id, new.created_at, new.has_attachment)
     is distinct from (old.channel_id, old.sender_id, old.created_at, old.has_attachment) then
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

create table public.message_attachments (
  id           uuid        primary key default gen_random_uuid(),
  message_id   uuid        not null references public.messages(id) on delete cascade,
  channel_id   uuid        not null references public.channels(id) on delete cascade,
  storage_path text        not null unique,
  filename     text        not null check (char_length(filename) between 1 and 200),
  size_bytes   bigint      not null check (size_bytes > 0 and size_bytes <= 10485760),
  mime_type    text        not null,
  created_at   timestamptz not null default now(),
  check (split_part(storage_path, '/', 1) = channel_id::text)
);

create index message_attachments_message_idx on public.message_attachments (message_id);

alter table public.message_attachments enable row level security;
revoke all on public.message_attachments from anon;

create policy "message_attachments: read" on public.message_attachments for select
  using (public.can_read_channel(channel_id));

-- only the sender of an attachment-flagged message adds attachments to it
create policy "message_attachments: add" on public.message_attachments for insert
  with check (
    public.can_post_channel(channel_id)
    and exists (select 1 from public.messages m
                where m.id = message_id and m.sender_id = auth.uid() and m.has_attachment
                  and m.deleted_at is null and m.channel_id = message_attachments.channel_id)
  );

create policy "message_attachments: remove" on public.message_attachments for delete
  using (
    exists (select 1 from public.messages m where m.id = message_id and m.sender_id = auth.uid())
    or public.can_moderate_channel(channel_id)
  );

create or replace function public.guard_attachment_count()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.message_attachments where message_id = new.message_id) >= 5 then
    raise exception 'A message can have up to 5 files';
  end if;
  return new;
end $$;

drop trigger if exists guard_attachment_count on public.message_attachments;
create trigger guard_attachment_count before insert on public.message_attachments
for each row execute function public.guard_attachment_count();

-- private bucket, same limits as task documents; path = <channel id>/<random>-<filename>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-files', 'chat-files', false, 10485760,
  array[
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv', 'image/png', 'image/jpeg'
  ]
)
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- malformed / traversal paths are denied, never an error
create or replace function public.channel_of_file(p_path text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  if p_path !~ '^[0-9a-fA-F-]{36}/[^/]+$' then return null; end if;
  return split_part(p_path, '/', 1)::uuid;
exception when others then
  return null;
end $$;

create policy "chat-files: read" on storage.objects for select to authenticated
  using (bucket_id = 'chat-files' and public.can_read_channel(public.channel_of_file(name)));

create policy "chat-files: upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-files' and public.can_post_channel(public.channel_of_file(name)));

create policy "chat-files: delete" on storage.objects for delete to authenticated
  using (bucket_id = 'chat-files' and public.can_read_channel(public.channel_of_file(name))
         and (owner_id = auth.uid()::text or public.can_moderate_channel(public.channel_of_file(name))));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_attachments') then
    alter publication supabase_realtime add table public.message_attachments;
  end if;
end $$;

-- ============================================================
-- 8. Message search (SECURITY INVOKER: row level security limits it to conversations you can read)
-- ============================================================
create or replace function public.search_messages(p_query text, p_limit int default 30)
returns table (id uuid, channel_id uuid, sender_id uuid, body text, created_at timestamptz)
language sql stable set search_path = '' as $$
  select m.id, m.channel_id, m.sender_id, m.body, m.created_at
  from public.messages m
  where char_length(btrim(coalesce(p_query, ''))) >= 2
    and m.deleted_at is null
    and m.body ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  order by m.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 50)
$$;
revoke all on function public.search_messages(text, int) from public, anon;
grant execute on function public.search_messages(text, int) to authenticated;

-- ============================================================
-- 9. Audit: department decisions
-- ============================================================
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

  elsif tg_table_name = 'department_access' then
    -- entity_id is the department channel; the delta says who and what was decided
    v_id := coalesce(new.channel_id, old.channel_id);
    if tg_op = 'UPDATE' then
      if new.status is not distinct from old.status then return new; end if;
      v_delta := jsonb_build_object('user_id', new.user_id, 'status_from', old.status, 'status_to', new.status);
      v_actor := coalesce(auth.uid(), new.decided_by);
    else
      v_delta := jsonb_build_object('user_id', coalesce(new.user_id, old.user_id), 'status', coalesce(new.status, old.status));
    end if;
  end if;

  insert into public.audit_log (action, entity, entity_id, performed_by, delta)
  values (lower(tg_op), tg_table_name, v_id, v_actor, v_delta);

  return coalesce(new, old);
end $$;

drop trigger if exists audit_department_access on public.department_access;
create trigger audit_department_access after insert or update or delete on public.department_access
for each row execute function public.write_audit();
