-- T04b / AC-02 (second half): one private PDF per character, owner-only.
-- Storage objects are inserted directly as the signed-in role, which is what the
-- Storage API does after checking these same policies.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'alice@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'bob@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'carol@example.test');

create temp table ctx (k text primary key, v text) on commit drop;
grant select, insert on ctx to authenticated;

select results_eq(
  $$ select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'character-pdfs' $$,
  $$ values (false, 10485760::bigint, array['application/pdf']) $$,
  'the bucket is private, 10 MiB, PDF only'
);

-- Alice has a character; Bob has one too.
set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}';
insert into ctx select 'bob_char', public.save_character(null, 'Bob char', null, null, null, null, null)::text;
set local request.jwt.claims = '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}';
insert into ctx select 'alice_char', public.save_character(null, 'Lyra', null, null, null, null, null)::text;

insert into ctx select 'path', public.begin_pdf_upload((select v::uuid from ctx where k = 'alice_char'));
select is(
  (select v from ctx where k = 'path'),
  '11111111-1111-4111-8111-111111111111/' || (select v from ctx where k = 'alice_char') || '.pdf',
  'begin returns <owner>/<character>.pdf'
);
select is(
  public.begin_pdf_upload((select v::uuid from ctx where k = 'alice_char')),
  (select v from ctx where k = 'path'),
  'begin again while pending returns the same path'
);
select throws_ok(
  $$ select public.begin_pdf_upload((select v::uuid from ctx where k = 'bob_char')) $$,
  'PGRST', '{"code":"character_not_found","message":"character_not_found"}',
  'Alice cannot start an upload for Bob''s character'
);
select throws_ok(
  $$ select public.finish_pdf_upload((select v::uuid from ctx where k = 'alice_char')) $$,
  'PGRST', '{"code":"pdf_not_uploaded","message":"pdf_not_uploaded"}',
  'finish before uploading fails'
);

-- Storage rules.
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, metadata)
     values ('character-pdfs', (select v from ctx where k = 'path'),
             '{"size": 2048, "mimetype": "application/pdf"}') $$,
  'Alice can upload to her pending path'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, metadata)
     values ('character-pdfs', '11111111-1111-4111-8111-111111111111/other.pdf', '{}') $$,
  '42501', null,
  'Alice cannot upload to a path without a pending row'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, metadata)
     values ('character-pdfs', '22222222-2222-4222-8222-222222222222/' || (select v from ctx where k = 'bob_char') || '.pdf', '{}') $$,
  '42501', null,
  'Alice cannot upload into Bob''s folder'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, metadata)
     values ('some-other-bucket', (select v from ctx where k = 'path'), '{}') $$,
  '42501', null,
  'the policies do not apply to other buckets'
);

select is(
  public.finish_pdf_upload((select v::uuid from ctx where k = 'alice_char')),
  2048::bigint,
  'finish marks the PDF ready and returns its size'
);
select is(
  public.finish_pdf_upload((select v::uuid from ctx where k = 'alice_char')),
  2048::bigint,
  'finish is idempotent'
);
select throws_ok(
  $$ select public.begin_pdf_upload((select v::uuid from ctx where k = 'alice_char')) $$,
  'PGRST', '{"code":"pdf_exists","message":"pdf_exists"}',
  'a second PDF for the same character is rejected'
);
select is(
  (with u as (
     update storage.objects set metadata = '{"size": 1, "mimetype": "application/pdf"}'
      where bucket_id = 'character-pdfs' and name = (select v from ctx where k = 'path')
      returning 1)
   select count(*)::int from u),
  0,
  'a ready PDF cannot be overwritten'
);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'character-pdfs'),
  1,
  'Alice can read her own PDF'
);
select results_eq(
  'select status::text, size_bytes from public.character_pdfs',
  $$ values ('ready', 2048::bigint) $$,
  'Alice sees her PDF as ready'
);
reset role;

-- Bob cannot see Alice's file or its record.
set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}';
select is_empty(
  $$ select 1 from storage.objects where bucket_id = 'character-pdfs' $$,
  'Bob cannot read Alice''s PDF'
);
select is_empty('select 1 from public.character_pdfs', 'Bob cannot see Alice''s PDF record');
reset role;

-- Validation at finish: wrong declared type or oversize stays pending.
set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}';
insert into ctx select 'bob_path', public.begin_pdf_upload((select v::uuid from ctx where k = 'bob_char'));
insert into storage.objects (bucket_id, name, metadata)
values ('character-pdfs', (select v from ctx where k = 'bob_path'), '{"size": 100, "mimetype": "image/png"}');
select throws_ok(
  $$ select public.finish_pdf_upload((select v::uuid from ctx where k = 'bob_char')) $$,
  'PGRST', '{"code":"pdf_invalid","message":"pdf_invalid"}',
  'a non-PDF type is rejected at finish'
);
select is(
  (with u as (
     update storage.objects set metadata = '{"size": 100, "mimetype": "application/pdf"}'
      where bucket_id = 'character-pdfs' and name = (select v from ctx where k = 'bob_path')
      returning 1)
   select count(*)::int from u),
  1,
  'while pending, the upload can be retried (overwritten)'
);
select is(
  public.finish_pdf_upload((select v::uuid from ctx where k = 'bob_char')),
  100::bigint,
  'after a retry, finish succeeds'
);
reset role;

-- Per-user limit: ten PDFs.
set local role authenticated;
set local request.jwt.claims = '{"sub": "33333333-3333-4333-8333-333333333333", "role": "authenticated"}';
do $$
declare i int; c uuid;
begin
  for i in 1..10 loop
    c := public.save_character(null, 'C' || i, null, null, null, null, null);
    perform public.begin_pdf_upload(c);
  end loop;
end $$;
insert into ctx select 'carol_11', public.save_character(null, 'C11', null, null, null, null, null)::text;
select throws_ok(
  $$ select public.begin_pdf_upload((select v::uuid from ctx where k = 'carol_11')) $$,
  'PGRST', '{"code":"pdf_limit_reached","message":"pdf_limit_reached"}',
  'the eleventh PDF is rejected'
);
reset role;

set local role anon;
select throws_ok(
  $$ select public.begin_pdf_upload(gen_random_uuid()) $$, '42501', null,
  'a visitor cannot start an upload'
);
reset role;

select * from finish();
rollback;
