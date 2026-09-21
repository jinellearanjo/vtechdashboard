-- Signup, legacy accounts and privacy:
--   1. Sign-up needs an invite code (the Terms already say "invitation-only"). Switchable in app_settings.
--   2. An auth user with no profile (e.g. someone who called the sign-up API directly) can no longer read anything.
--   3. Legacy (no-email) accounts can only be Contributors.
--   4. Date of birth moves to a private table only its owner can read (managers and admins can't).

-- ============================================================
-- 1. Invite-only sign-up
-- ============================================================
create table public.app_settings (
  key   text  primary key,
  value jsonb not null
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;   -- changed from the SQL editor only

insert into public.app_settings (key, value) values ('signup_requires_invite', 'true')
on conflict (key) do nothing;

-- The sign-up page asks this before showing the form (callable while signed out).
create or replace function public.get_signup_config()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'invite_required',
    coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'signup_requires_invite'), true)
  )
$$;
revoke all on function public.get_signup_config() from public;
grant execute on function public.get_signup_config() to anon, authenticated;

-- ============================================================
-- 2. Being signed in is not enough: you need a profile
-- ============================================================
create or replace function public.has_profile()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid())
$$;
revoke all on function public.has_profile() from public, anon;
grant execute on function public.has_profile() to authenticated;

create or replace function public.can_read_channel(p_channel uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_profile() and exists (select 1 from public.channels c
                 where c.id = p_channel and (c.type = 'public' or public.is_channel_member(c.id)))
$$;

create or replace function public.can_post_channel(p_channel uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_profile() and exists (select 1 from public.channels c
                 where c.id = p_channel and c.archived_at is null
                   and (c.type = 'public' or public.is_channel_member(c.id)))
$$;

drop policy if exists "channels: read" on public.channels;
create policy "channels: read" on public.channels for select
  using (public.has_profile() and (type = 'public' or public.is_channel_member(id)));

create or replace function public.get_directory()
returns table (id uuid, first_name text, last_name text, role text, avatar_path text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.first_name, p.last_name, p.role, p.avatar_path from public.profiles p
  where public.has_profile()
  order by p.first_name, p.last_name
$$;

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
  where public.has_profile() and (c.type = 'public' or me.user_id is not null)
  order by lm.last_at desc nulls last, c.title
$$;

-- ============================================================
-- 3. Legacy accounts are Contributors only
-- ============================================================
create or replace function public.guard_legacy_role()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_legacy and new.role <> 'employee'
     and (tg_op = 'INSERT' or new.role is distinct from old.role or new.is_legacy is distinct from old.is_legacy) then
    raise exception 'Legacy accounts can only be Contributors. Use an email account for manager or admin access.';
  end if;
  return new;
end $$;

drop trigger if exists guard_legacy_role on public.profiles;
create trigger guard_legacy_role before insert or update on public.profiles
for each row execute function public.guard_legacy_role();

-- ============================================================
-- 4. Private date of birth
-- ============================================================
create table public.profile_private (
  id            uuid primary key references public.profiles(id) on delete cascade,
  date_of_birth date check (date_of_birth is null or date_of_birth <= current_date)
);

alter table public.profile_private enable row level security;
revoke all on public.profile_private from anon;

create policy "profile_private: read own"   on public.profile_private for select using (id = auth.uid());
create policy "profile_private: insert own" on public.profile_private for insert with check (id = auth.uid());
create policy "profile_private: update own" on public.profile_private for update
  using (id = auth.uid()) with check (id = auth.uid());
-- no policy for anyone else: not managers, not admins

insert into public.profile_private (id, date_of_birth)
select id, date_of_birth from public.profiles
on conflict (id) do nothing;

-- ============================================================
-- 5. Sign-up trigger: invite required, legacy cap, private date of birth
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  m        jsonb   := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_code   text    := upper(trim(coalesce(m->>'invite_code', '')));
  v_role   text    := 'employee';
  v_legacy boolean := coalesce((m->>'is_legacy')::boolean, false);
  v_needs  boolean;
  inv      public.invite_codes%rowtype;
begin
  -- Users created without sign-up metadata (Supabase dashboard, auth.admin.createUser) get no profile
  -- automatically; create theirs by hand. Without a profile they can't read anything (has_profile()).
  if nullif(m->>'username', '') is null then
    return new;
  end if;

  select coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'signup_requires_invite'), true)
    into v_needs;
  if v_code = '' and v_needs then
    raise exception 'An invite code is required to create an account';
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

  if v_legacy and v_role <> 'employee' then
    raise exception 'Legacy accounts can only be Contributors';
  end if;

  insert into public.profiles
    (id, username, first_name, middle_name, last_name, role, is_legacy)
  values
    (new.id, lower(m->>'username'), m->>'first_name', nullif(m->>'middle_name', ''),
     m->>'last_name', v_role, v_legacy);

  insert into public.profile_private (id, date_of_birth)
  values (new.id, nullif(m->>'date_of_birth', '')::date);

  if v_code <> '' then
    update public.invite_codes set used_by = new.id, used_at = now() where id = inv.id;
  end if;

  return new;
end $$;

-- ============================================================
-- 6. Profile guard without date of birth, then drop the old column
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
       and (new.username, new.first_name, new.middle_name, new.last_name, new.avatar_path, new.display_role)
           is distinct from
           (old.username, old.first_name, old.middle_name, old.last_name, old.avatar_path, old.display_role) then
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

  return new;
end $$;

alter table public.profiles drop column date_of_birth;
