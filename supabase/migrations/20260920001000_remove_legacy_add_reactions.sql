-- Remove legacy (no-email, device-remembered) accounts entirely, and add message reactions.

-- ============================================================
-- 1. No more legacy sign-ups; existing legacy accounts must add an email
-- ============================================================
-- handle_new_user ignores any is_legacy flag from here on: every new account has a real email.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  m      jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_code text  := upper(trim(coalesce(m->>'invite_code', '')));
  v_role text  := 'employee';
  v_needs boolean;
  inv    public.invite_codes%rowtype;
begin
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

  insert into public.profiles
    (id, username, first_name, middle_name, last_name, role, is_legacy)
  values
    (new.id, lower(m->>'username'), m->>'first_name', nullif(m->>'middle_name', ''), m->>'last_name', v_role, false);

  insert into public.profile_private (id, date_of_birth)
  values (new.id, nullif(m->>'date_of_birth', '')::date);

  if v_code <> '' then
    update public.invite_codes set used_by = new.id, used_at = now() where id = inv.id;
  end if;

  return new;
end $$;

-- guard_legacy_role (from 0800) already blocks a legacy account from holding manager/admin; extend it so
-- is_legacy can never be set true again, from any client (admins included) or the SQL editor.
create or replace function public.guard_legacy_role()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_legacy then
    raise exception 'Legacy accounts are no longer supported. Add an email address for this account instead.';
  end if;
  return new;
end $$;

-- Existing legacy accounts (if any) keep working until each is converted; flag them for follow-up.
create table if not exists public.legacy_conversion_needed (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  username   text not null,
  flagged_at timestamptz not null default now()
);
alter table public.legacy_conversion_needed enable row level security;
revoke all on public.legacy_conversion_needed from anon, authenticated;

insert into public.legacy_conversion_needed (user_id, username)
select id, username from public.profiles where is_legacy
on conflict (user_id) do nothing;

-- ============================================================
-- 2. Message reactions
-- ============================================================
create table public.message_reactions (
  message_id uuid        not null references public.messages(id) on delete cascade,
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  emoji      text        not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index message_reactions_message_idx on public.message_reactions (message_id);

alter table public.message_reactions enable row level security;
revoke all on public.message_reactions from anon;

create policy "message_reactions: read" on public.message_reactions for select
  using (exists (select 1 from public.messages m where m.id = message_id and public.can_read_channel(m.channel_id)));

create policy "message_reactions: add own" on public.message_reactions for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.messages m
                where m.id = message_id and m.deleted_at is null and public.can_post_channel(m.channel_id))
  );

create policy "message_reactions: remove own" on public.message_reactions for delete
  using (user_id = auth.uid());

create or replace function public.guard_reaction_count()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(distinct emoji) from public.message_reactions where message_id = new.message_id and user_id = new.user_id) >= 20 then
    raise exception 'Too many different reactions on one message from you';
  end if;
  return new;
end $$;

drop trigger if exists guard_reaction_count on public.message_reactions;
create trigger guard_reaction_count before insert on public.message_reactions
for each row execute function public.guard_reaction_count();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions') then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end $$;
