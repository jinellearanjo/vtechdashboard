-- Document submission: files attached to tasks, stored in a private bucket.
-- Path convention: <task_id>/<random-uuid>-<sanitised filename>

-- ============================================================
-- 1. Access helpers (security definer, so policies don't recurse into RLS)
-- ============================================================
create or replace function public.can_access_task(p_task_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and (t.assigned_to = auth.uid() or public.get_my_role() in ('manager', 'admin'))
  )
$$;

create or replace function public.can_access_task_file(p_path text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
begin
  -- exactly "<uuid>/<filename>"; anything else (traversal, bad uuid) is denied, never an error
  if p_path !~ '^[0-9a-fA-F-]{36}/[^/]+$' then return false; end if;
  return public.can_access_task(split_part(p_path, '/', 1)::uuid);
exception when others then
  return false;
end $$;

revoke all on function public.can_access_task(uuid)      from public, anon;
revoke all on function public.can_access_task_file(text) from public, anon;
grant execute on function public.can_access_task(uuid)      to authenticated;
grant execute on function public.can_access_task_file(text) to authenticated;

-- ============================================================
-- 2. Documents table
-- ============================================================
create table public.task_documents (
  id           uuid        primary key default gen_random_uuid(),
  task_id      uuid        not null references public.tasks(id) on delete cascade,
  uploaded_by  uuid        references public.profiles(id) on delete set null,
  storage_path text        not null unique,
  filename     text        not null check (char_length(filename) between 1 and 200),
  size_bytes   bigint      not null check (size_bytes > 0 and size_bytes <= 10485760),
  mime_type    text        not null,
  created_at   timestamptz not null default now(),
  check (split_part(storage_path, '/', 1) = task_id::text)
);

create index task_documents_task_idx on public.task_documents (task_id, created_at desc);

alter table public.task_documents enable row level security;
revoke all on public.task_documents from anon;

create policy "task_documents: read" on public.task_documents for select
  using (public.can_access_task(task_id));

create policy "task_documents: insert" on public.task_documents for insert
  with check (uploaded_by = auth.uid() and public.can_access_task(task_id));

create policy "task_documents: delete" on public.task_documents for delete
  using (
    public.can_access_task(task_id)
    and (uploaded_by = auth.uid() or public.get_my_role() in ('manager', 'admin'))
  );
-- no update policy: documents are immutable once submitted

-- ============================================================
-- 3. Private storage bucket (10 MB, document/image types only)
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-docs', 'task-docs', false, 10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "task-docs: read" on storage.objects for select to authenticated
  using (bucket_id = 'task-docs' and public.can_access_task_file(name));

create policy "task-docs: upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'task-docs' and public.can_access_task_file(name));

create policy "task-docs: delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'task-docs'
    and public.can_access_task_file(name)
    and (owner_id = auth.uid()::text or public.get_my_role() in ('manager', 'admin'))
  );
-- no update policy: uploads can't be overwritten (upsert is off)

-- ============================================================
-- 4. Audit log: record uploads and deletions (filename only, never file contents)
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

  elsif tg_table_name = 'task_documents' then
    v_id := coalesce(new.id, old.id);
    if tg_op = 'INSERT' then
      v_delta := jsonb_build_object('task_id', new.task_id, 'filename', new.filename, 'size_bytes', new.size_bytes);
    elsif tg_op = 'DELETE' then
      v_delta := jsonb_build_object('task_id', old.task_id, 'filename', old.filename);
    else
      return new;
    end if;
  end if;

  insert into public.audit_log (action, entity, entity_id, performed_by, delta)
  values (lower(tg_op), tg_table_name, v_id, auth.uid(), v_delta);

  return coalesce(new, old);
end $$;

drop trigger if exists audit_task_documents on public.task_documents;
create trigger audit_task_documents after insert or delete on public.task_documents
for each row execute function public.write_audit();
