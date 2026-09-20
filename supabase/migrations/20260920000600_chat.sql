-- Chat: channels become real conversations (public channels, group chats, direct messages) with
-- membership, unread tracking and messages.
--
-- Privacy model: public channels are open to everyone signed in. Group chats and DMs are readable ONLY by their
-- members: managers and admins cannot read them. Managers/admins can moderate (soft-delete) messages in public channels.

-- ============================================================
-- 1. Channel columns
-- ============================================================
alter table public.channels
  add column title       text check (title is null or char_length(title) between 1 and 60),
  add column archived_at timestamptz,
  add column dm_key      text unique;   -- "<smaller user id>:<larger user id>" for direct messages

-- 'lead-gen' -> 'Lead Gen' (audit trigger paused so this backfill doesn't add seven noise rows to the log)
alter table public.channels disable trigger audit_channels;
update public.channels set title = initcap(replace(name, '-', ' ')) where title is null;
alter table public.channels enable trigger audit_channels;

-- ============================================================
-- 2. Members and messages
-- ============================================================
create table public.channel_members (
  channel_id   uuid        not null references public.channels(id) on delete cascade,
  user_id      uuid        not null references public.profiles(id) on delete cascade,
  role         text        not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create index channel_members_user_idx on public.channel_members (user_id);

create table public.messages (
  id         uuid        primary key default gen_random_uuid(),
  channel_id uuid        not null references public.channels(id) on delete cascade,
  sender_id  uuid        references public.profiles(id) on delete set null,
  body       text        not null,
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  deleted_at timestamptz,
  check (deleted_at is not null or char_length(btrim(body)) between 1 and 4000)
);

create index messages_channel_created_idx on public.messages (channel_id, created_at desc);

alter table public.channel_members enable row level security;
alter table public.messages        enable row level security;
revoke all on public.channel_members, public.messages from anon;

-- ============================================================
-- 3. Access helpers (security definer: no RLS recursion between channels / members / messages)
-- ============================================================
create or replace function public.is_channel_member(p_channel uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.channel_members m where m.channel_id = p_channel and m.user_id = auth.uid())
$$;

create or replace function public.is_channel_owner(p_channel uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.channel_members m
                 where m.channel_id = p_channel and m.user_id = auth.uid() and m.role = 'owner')
$$;

create or replace function public.can_read_channel(p_channel uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.channels c
                 where c.id = p_channel and (c.type = 'public' or public.is_channel_member(c.id)))
$$;

create or replace function public.can_post_channel(p_channel uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.channels c
                 where c.id = p_channel and c.archived_at is null
                   and (c.type = 'public' or public.is_channel_member(c.id)))
$$;

-- managers/admins may delete messages in PUBLIC channels only
create or replace function public.can_moderate_channel(p_channel uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.get_my_role() in ('manager', 'admin')
     and exists (select 1 from public.channels c where c.id = p_channel and c.type = 'public')
$$;

revoke all on function public.is_channel_member(uuid), public.is_channel_owner(uuid), public.can_read_channel(uuid),
                       public.can_post_channel(uuid), public.can_moderate_channel(uuid) from public, anon;
grant execute on function public.is_channel_member(uuid), public.is_channel_owner(uuid), public.can_read_channel(uuid),
                          public.can_post_channel(uuid), public.can_moderate_channel(uuid) to authenticated;

-- ============================================================
-- 4. Policies
-- ============================================================
-- channels
drop policy if exists "channels: read"          on public.channels;
drop policy if exists "channels: manage insert" on public.channels;
drop policy if exists "channels: manage update" on public.channels;
drop policy if exists "channels: manage delete" on public.channels;

create policy "channels: read" on public.channels for select
  using (type = 'public' or public.is_channel_member(id));

-- managers/admins create PUBLIC channels directly; group chats and DMs go through the functions below
create policy "channels: insert public" on public.channels for insert
  with check (public.get_my_role() in ('manager', 'admin') and type = 'public' and created_by = auth.uid());

create policy "channels: update" on public.channels for update
  using ((public.get_my_role() in ('manager', 'admin') and type = 'public') or public.is_channel_owner(id))
  with check ((public.get_my_role() in ('manager', 'admin') and type = 'public') or public.is_channel_owner(id));

-- deleting a channel destroys its history: admins only, public channels only (everyone else archives)
create policy "channels: delete public" on public.channels for delete
  using (public.get_my_role() = 'admin' and type = 'public');

-- channel_members: read-only from the client; joining, leaving and read state go through functions/triggers
create policy "channel_members: read" on public.channel_members for select
  using (user_id = auth.uid() or public.is_channel_member(channel_id));

-- messages
create policy "messages: read" on public.messages for select
  using (public.can_read_channel(channel_id));

create policy "messages: send" on public.messages for insert
  with check (sender_id = auth.uid() and public.can_post_channel(channel_id)
              and edited_at is null and deleted_at is null);

create policy "messages: edit or delete" on public.messages for update
  using (public.can_read_channel(channel_id) and (sender_id = auth.uid() or public.can_moderate_channel(channel_id)))
  with check (public.can_read_channel(channel_id) and (sender_id = auth.uid() or public.can_moderate_channel(channel_id)));
-- no delete policy: messages are soft-deleted

-- ============================================================
-- 5. Guard triggers
-- ============================================================
create or replace function public.guard_channel_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.name, new.type, new.dm_key, new.created_by, new.created_at)
     is distinct from (old.name, old.type, old.dm_key, old.created_by, old.created_at) then
    raise exception 'A channel''s name, type and owner cannot be changed';
  end if;
  if old.type = 'direct' then
    raise exception 'Direct messages cannot be edited';
  end if;
  return new;
end $$;

drop trigger if exists guard_channel_update on public.channels;
create trigger guard_channel_update before update on public.channels
for each row execute function public.guard_channel_update();

create or replace function public.guard_message_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
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

drop trigger if exists guard_message_update on public.messages;
create trigger guard_message_update before update on public.messages
for each row execute function public.guard_message_update();

-- ============================================================
-- 6. Everyone is a member of every public channel (so unread tracking works)
-- ============================================================
create or replace function public.join_new_public_channel()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.type = 'public' then
    insert into public.channel_members (channel_id, user_id, role)
    select new.id, p.id, case when p.id = new.created_by then 'owner' else 'member' end
    from public.profiles p
    on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists join_new_public_channel on public.channels;
create trigger join_new_public_channel after insert on public.channels
for each row execute function public.join_new_public_channel();

create or replace function public.join_public_channels_for_new_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.channel_members (channel_id, user_id)
  select c.id, new.id from public.channels c where c.type = 'public'
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists join_public_channels on public.profiles;
create trigger join_public_channels after insert on public.profiles
for each row execute function public.join_public_channels_for_new_profile();

-- existing people join the existing public channels (no unread backlog: last_read_at = now())
insert into public.channel_members (channel_id, user_id)
select c.id, p.id from public.channels c cross join public.profiles p where c.type = 'public'
on conflict do nothing;

-- ============================================================
-- 7. Functions the client calls
-- ============================================================
-- Names of everyone (for pickers and message authors). Profile rows themselves stay private.
create or replace function public.get_directory()
returns table (id uuid, first_name text, last_name text, role text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.first_name, p.last_name, p.role from public.profiles p
  where auth.uid() is not null
  order by p.first_name, p.last_name
$$;

-- Sidebar data: every conversation I can see, with unread count and (for DMs) the other person.
create or replace function public.get_channel_overview()
returns table (
  id uuid, name text, title text, description text, type text, archived_at timestamptz, created_by uuid,
  last_message_at timestamptz, unread_count bigint, member_count bigint, my_role text, dm_user_id uuid
)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.title, c.description, c.type, c.archived_at, c.created_by,
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
  where auth.uid() is not null and (c.type = 'public' or me.user_id is not null)
  order by lm.last_at desc nulls last, c.title
$$;

create or replace function public.get_unread_total()
returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from public.messages m
  join public.channel_members me on me.channel_id = m.channel_id and me.user_id = auth.uid()
  join public.channels c on c.id = m.channel_id
  where auth.uid() is not null and c.archived_at is null and m.deleted_at is null
    and m.sender_id is distinct from auth.uid() and m.created_at > me.last_read_at
$$;

create or replace function public.mark_channel_read(p_channel uuid)
returns void language sql security definer set search_path = '' as $$
  update public.channel_members set last_read_at = now()
  where channel_id = p_channel and user_id = auth.uid()
$$;

create or replace function public.get_channel_members(p_channel uuid)
returns table (id uuid, first_name text, last_name text, role text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.first_name, p.last_name, m.role
  from public.channel_members m join public.profiles p on p.id = m.user_id
  where m.channel_id = p_channel and public.can_read_channel(p_channel)
  order by (m.role = 'owner') desc, p.first_name, p.last_name
$$;

create or replace function public.get_or_create_dm(p_other uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me  uuid := auth.uid();
  v_key text;
  v_id  uuid;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if p_other is null or p_other = v_me then raise exception 'Choose someone else'; end if;
  if not exists (select 1 from public.profiles where id = p_other) then raise exception 'Unknown user'; end if;

  v_key := least(v_me::text, p_other::text) || ':' || greatest(v_me::text, p_other::text);
  select id into v_id from public.channels where dm_key = v_key;

  if v_id is null then
    insert into public.channels (name, type, dm_key, created_by)
    values ('dm-' || substr(md5(v_key), 1, 24), 'direct', v_key, v_me)
    on conflict (dm_key) do nothing
    returning id into v_id;
    if v_id is null then select id into v_id from public.channels where dm_key = v_key; end if;

    insert into public.channel_members (channel_id, user_id) values (v_id, v_me), (v_id, p_other)
    on conflict do nothing;
  end if;
  return v_id;
end $$;

create or replace function public.create_group_chat(p_title text, p_member_ids uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := auth.uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_ids   uuid[];
  v_id    uuid;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if char_length(v_title) not between 1 and 60 then raise exception 'Give the group a name (up to 60 characters)'; end if;

  select coalesce(array_agg(distinct u), '{}') into v_ids
  from unnest(coalesce(p_member_ids, '{}')) u
  where u <> v_me and exists (select 1 from public.profiles p where p.id = u);

  if cardinality(v_ids) < 1  then raise exception 'Add at least one other person'; end if;
  if cardinality(v_ids) > 50 then raise exception 'A group can have at most 51 people'; end if;

  insert into public.channels (name, title, type, created_by)
  values ('grp-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), v_title, 'private', v_me)
  returning id into v_id;

  insert into public.channel_members (channel_id, user_id, role) values (v_id, v_me, 'owner');
  insert into public.channel_members (channel_id, user_id) select v_id, u from unnest(v_ids) u;
  return v_id;
end $$;

create or replace function public.add_channel_members(p_channel uuid, p_user_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.channels c where c.id = p_channel and c.type = 'private' and c.archived_at is null) then
    raise exception 'Members can only be added to active group chats';
  end if;
  if not public.is_channel_owner(p_channel) then raise exception 'Only the group owner can add people'; end if;
  if (select count(*) from public.channel_members where channel_id = p_channel) + coalesce(cardinality(p_user_ids), 0) > 51 then
    raise exception 'A group can have at most 51 people';
  end if;

  insert into public.channel_members (channel_id, user_id)
  select p_channel, p.id from public.profiles p where p.id = any(coalesce(p_user_ids, '{}'))
  on conflict do nothing;
end $$;

-- The owner removes someone, or anyone leaves (p_user_id = themselves). If the last owner leaves, the longest-standing
-- member becomes owner; if nobody is left the group is archived.
create or replace function public.remove_channel_member(p_channel uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from public.channels c where c.id = p_channel and c.type = 'private') then
    raise exception 'You can only leave or remove people from group chats';
  end if;
  if p_user_id <> auth.uid() and not public.is_channel_owner(p_channel) then
    raise exception 'Only the group owner can remove people';
  end if;

  delete from public.channel_members where channel_id = p_channel and user_id = p_user_id;

  if not exists (select 1 from public.channel_members where channel_id = p_channel) then
    update public.channels set archived_at = now() where id = p_channel and archived_at is null;
  elsif not exists (select 1 from public.channel_members where channel_id = p_channel and role = 'owner') then
    update public.channel_members set role = 'owner'
    where channel_id = p_channel
      and user_id = (select user_id from public.channel_members where channel_id = p_channel order by joined_at, user_id limit 1);
  end if;
end $$;

revoke all on function public.get_directory(), public.get_channel_overview(), public.get_unread_total(),
  public.mark_channel_read(uuid), public.get_channel_members(uuid), public.get_or_create_dm(uuid),
  public.create_group_chat(text, uuid[]), public.add_channel_members(uuid, uuid[]),
  public.remove_channel_member(uuid, uuid) from public, anon;
grant execute on function public.get_directory(), public.get_channel_overview(), public.get_unread_total(),
  public.mark_channel_read(uuid), public.get_channel_members(uuid), public.get_or_create_dm(uuid),
  public.create_group_chat(text, uuid[]), public.add_channel_members(uuid, uuid[]),
  public.remove_channel_member(uuid, uuid) to authenticated;

-- ============================================================
-- 8. Realtime (RLS decides who receives which events)
-- ============================================================
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['messages', 'channels', 'channel_members'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ============================================================
-- 9. Audit: public channel changes only (see write_audit)
-- ============================================================
create or replace function public.write_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_delta jsonb;
  v_actor uuid := auth.uid();
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
