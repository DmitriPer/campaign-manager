-- T04b: one private PDF per character (AC-02 second half; decisions A20, A21).
--
-- Upload flow:
--   1. begin_pdf_upload(character)  -> reserves a 'pending' row, returns the path
--                                      '<owner uid>/<character id>.pdf'
--   2. the browser uploads the file to bucket 'character-pdfs' at that path
--   3. finish_pdf_upload(character) -> checks the stored object (size, declared
--                                      type) and marks the row 'ready'
-- Storage policies allow writing only a path that has a PENDING row of the
-- caller, so a ready PDF cannot be overwritten and a second PDF per character
-- is rejected in the pilot. Only the owner can read the file.
--
-- Honest limit (A20): the MIME type is declared by the client; the database
-- cannot inspect file bytes, so a non-PDF sent as application/pdf is accepted.
-- Only the owner can ever download it.
--
-- No DELETE policy: deleting/replacing a PDF is not in the pilot. A future delete
-- must go through the Storage API (direct SQL deletes on storage.objects are
-- blocked by Supabase).
--
-- Errors (PGRST custom errors with HTTP status): character_not_found (404),
-- pdf_not_started (404), pdf_exists (409), pdf_limit_reached (409),
-- pdf_not_uploaded (409), pdf_invalid (422). auth_required (42501).

-- The bucket is created here (not in config.toml) so local, CI and hosted match.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('character-pdfs', 'character-pdfs', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

create type public.pdf_status as enum ('pending', 'ready');

create table public.character_pdfs (
  character_id uuid primary key references public.characters (id) on delete cascade,
  owner_id     uuid not null references auth.users (id) on delete cascade,
  object_path  text not null unique,
  status       public.pdf_status not null default 'pending',
  size_bytes   bigint check (size_bytes is null or size_bytes between 1 and 10485760),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index character_pdfs_owner_idx on public.character_pdfs (owner_id);

alter table public.character_pdfs enable row level security;
grant select on public.character_pdfs to authenticated;

create policy character_pdfs_select_own
  on public.character_pdfs for select to authenticated
  using (owner_id = (select auth.uid()));

-- Status of the caller's own PDF row for an exact object path, or null.
create function app_private.own_pdf_status(p_object_name text)
returns public.pdf_status
language sql
stable
security definer
set search_path = ''
as $$
  select p.status
    from public.character_pdfs p
   where p.object_path = p_object_name and p.owner_id = (select auth.uid());
$$;

revoke all on function app_private.own_pdf_status(text) from public, anon, authenticated;
grant execute on function app_private.own_pdf_status(text) to authenticated;

-- Storage policies. Every one is scoped to this bucket.
create policy character_pdfs_insert_pending
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'character-pdfs'
    and (select app_private.own_pdf_status(name)) = 'pending'
  );

create policy character_pdfs_update_pending
  on storage.objects for update to authenticated
  using (
    bucket_id = 'character-pdfs'
    and (select app_private.own_pdf_status(name)) = 'pending'
  )
  with check (
    bucket_id = 'character-pdfs'
    and (select app_private.own_pdf_status(name)) = 'pending'
  );

-- The owner reads their own object (pending too: upsert on retry needs it).
create policy character_pdfs_select_own
  on storage.objects for select to authenticated
  using (
    bucket_id = 'character-pdfs'
    and (select app_private.own_pdf_status(name)) is not null
  );

-- Commands -------------------------------------------------------------------

create function public.begin_pdf_upload(p_character uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row  public.character_pdfs%rowtype;
  v_path text;
begin
  if v_user is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;

  -- Serialize this user's uploads so concurrent calls cannot exceed the limit.
  perform pg_advisory_xact_lock(hashtextextended('character_pdfs:' || v_user::text, 0));

  if not exists (select 1 from public.characters c where c.id = p_character and c.owner_id = v_user) then
    raise sqlstate 'PGRST' using
      message = '{"code":"character_not_found","message":"character_not_found"}',
      detail  = '{"status":404,"headers":{}}';
  end if;

  select * into v_row from public.character_pdfs where character_id = p_character;
  if found then
    if v_row.status = 'ready' then
      raise sqlstate 'PGRST' using
        message = '{"code":"pdf_exists","message":"pdf_exists"}',
        detail  = '{"status":409,"headers":{}}';
    end if;
    return v_row.object_path;  -- pending: retry with the same path
  end if;

  if (select count(*) from public.character_pdfs where owner_id = v_user) >= 10 then
    raise sqlstate 'PGRST' using
      message = '{"code":"pdf_limit_reached","message":"pdf_limit_reached"}',
      detail  = '{"status":409,"headers":{}}';
  end if;

  v_path := v_user::text || '/' || p_character::text || '.pdf';
  insert into public.character_pdfs (character_id, owner_id, object_path)
  values (p_character, v_user, v_path);
  return v_path;
end;
$$;

create function public.finish_pdf_upload(p_character uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row  public.character_pdfs%rowtype;
  v_size bigint;
  v_type text;
begin
  if v_user is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;

  select * into v_row from public.character_pdfs
   where character_id = p_character and owner_id = v_user
   for update;
  if not found then
    raise sqlstate 'PGRST' using
      message = '{"code":"pdf_not_started","message":"pdf_not_started"}',
      detail  = '{"status":404,"headers":{}}';
  end if;
  if v_row.status = 'ready' then
    return v_row.size_bytes;  -- idempotent
  end if;

  select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype'
    into v_size, v_type
    from storage.objects o
   where o.bucket_id = 'character-pdfs' and o.name = v_row.object_path;
  if not found then
    raise sqlstate 'PGRST' using
      message = '{"code":"pdf_not_uploaded","message":"pdf_not_uploaded"}',
      detail  = '{"status":409,"headers":{}}';
  end if;
  if v_size is null or v_size < 1 or v_size > 10485760 or v_type is distinct from 'application/pdf' then
    raise sqlstate 'PGRST' using
      message = '{"code":"pdf_invalid","message":"pdf_invalid"}',
      detail  = '{"status":422,"headers":{}}';
  end if;

  update public.character_pdfs
     set status = 'ready', size_bytes = v_size, updated_at = now()
   where character_id = p_character;
  return v_size;
end;
$$;

revoke all on function public.begin_pdf_upload(uuid) from public, anon, authenticated;
revoke all on function public.finish_pdf_upload(uuid) from public, anon, authenticated;
grant execute on function public.begin_pdf_upload(uuid) to authenticated;
grant execute on function public.finish_pdf_upload(uuid) to authenticated;
