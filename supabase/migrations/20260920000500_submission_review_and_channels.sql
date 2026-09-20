-- Submission review workflow (accept -> push to Google Drive / reject with a note) on task_documents,
-- plus the default messaging channels.
-- Reuses the existing documents feature (one upload flow, one private bucket) instead of a second table.

-- ============================================================
-- 1. Review columns
-- ============================================================
alter table public.task_documents
  add column status         text not null default 'pending_review'
                            check (status in ('pending_review', 'accepted', 'rejected')),
  add column reviewer_note  text check (reviewer_note is null or char_length(reviewer_note) <= 1000),
  add column reviewed_by    uuid references public.profiles(id) on delete set null,
  add column reviewed_at    timestamptz,
  add column drive_file_id  text,
  add column drive_file_url text,
  add column drive_folder   text;

create index task_documents_pending_idx on public.task_documents (task_id) where status = 'pending_review';

-- ============================================================
-- 2. Policies
-- ============================================================
-- Uploads always start as pending review with no reviewer facts (an employee can't insert "accepted").
drop policy if exists "task_documents: insert" on public.task_documents;
create policy "task_documents: insert" on public.task_documents for insert
  with check (
    uploaded_by = auth.uid()
    and public.can_access_task(task_id)
    and status = 'pending_review'
    and reviewer_note is null and reviewed_by is null and reviewed_at is null
    and drive_file_id is null and drive_file_url is null and drive_folder is null
  );

-- Only managers/admins can update rows (to reject); the trigger below limits what they can change.
create policy "task_documents: review update" on public.task_documents for update
  using (public.get_my_role() in ('manager', 'admin'))
  with check (public.get_my_role() in ('manager', 'admin'));

-- Uploaders can withdraw their own file until it has been accepted; managers/admins can delete any.
drop policy if exists "task_documents: delete" on public.task_documents;
create policy "task_documents: delete" on public.task_documents for delete
  using (
    public.can_access_task(task_id)
    and (
      public.get_my_role() in ('manager', 'admin')
      or (uploaded_by = auth.uid() and status <> 'accepted')
    )
  );

create or replace function public.is_document_accepted(p_path text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.task_documents d where d.storage_path = p_path and d.status = 'accepted'
  )
$$;

revoke all on function public.is_document_accepted(text) from public, anon;
grant execute on function public.is_document_accepted(text) to authenticated;

drop policy if exists "task-docs: delete" on storage.objects;
create policy "task-docs: delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'task-docs'
    and public.can_access_task_file(name)
    and (
      public.get_my_role() in ('manager', 'admin')
      or (owner_id = auth.uid()::text and not public.is_document_accepted(name))
    )
  );

-- ============================================================
-- 3. Guard trigger: what a review may change
--    auth.uid() is null for the service role (push-to-drive function) and the SQL editor.
-- ============================================================
create or replace function public.guard_document_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
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

drop trigger if exists guard_document_update on public.task_documents;
create trigger guard_document_update before update on public.task_documents
for each row execute function public.guard_document_update();

-- live "to review" counts on the manager dashboard
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_documents') then
    alter publication supabase_realtime add table public.task_documents;
  end if;
end $$;

-- ============================================================
-- 4. Channels (the messaging feature itself comes later; this is the channel list)
-- ============================================================
create table public.channels (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null unique check (name ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  description text        check (description is null or char_length(description) <= 200),
  type        text        not null default 'public' check (type in ('public', 'private', 'direct')),
  created_by  uuid        references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.channels enable row level security;
revoke all on public.channels from anon;

-- everyone signed in sees public channels; private/direct ones need membership, which arrives with
-- messaging, so for now only managers/admins can see them
create policy "channels: read" on public.channels for select
  using (type = 'public' or public.get_my_role() in ('manager', 'admin'));

create policy "channels: manage insert" on public.channels for insert
  with check (public.get_my_role() in ('manager', 'admin') and created_by = auth.uid());

create policy "channels: manage update" on public.channels for update
  using (public.get_my_role() in ('manager', 'admin'))
  with check (public.get_my_role() in ('manager', 'admin'));

create policy "channels: manage delete" on public.channels for delete
  using (public.get_my_role() in ('manager', 'admin'));

insert into public.channels (name, description, type) values
  ('marketing',   'Marketing campaigns, content, and brand discussions', 'public'),
  ('legal',       'Legal reviews, compliance, and contract discussions',  'public'),
  ('technical',   'Engineering, infrastructure, and technical work',      'public'),
  ('sales',       'Pipeline, leads, and client discussions',              'public'),
  ('automations', 'Workflow automations, tooling, and integrations',      'public'),
  ('finance',     'Budgets, invoicing, expenses, and financial reporting','public'),
  ('lead-gen',    'Lead generation, outreach, and prospecting',           'public')
on conflict (name) do nothing;

-- ============================================================
-- 5. Audit log: document reviews and channel changes (created after the seed so it isn't noisy)
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
    v_delta := case when tg_op = 'UPDATE'
                    then jsonb_build_object('name', new.name, 'type_from', old.type, 'type_to', new.type)
                    else jsonb_build_object('name', coalesce(new.name, old.name), 'type', coalesce(new.type, old.type)) end;
  end if;

  insert into public.audit_log (action, entity, entity_id, performed_by, delta)
  values (lower(tg_op), tg_table_name, v_id, v_actor, v_delta);

  return coalesce(new, old);
end $$;

drop trigger if exists audit_task_documents on public.task_documents;
create trigger audit_task_documents after insert or update or delete on public.task_documents
for each row execute function public.write_audit();

drop trigger if exists audit_channels on public.channels;
create trigger audit_channels after insert or update or delete on public.channels
for each row execute function public.write_audit();
