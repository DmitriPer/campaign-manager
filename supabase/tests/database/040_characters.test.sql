-- T04a / AC-02 (first half): personal characters, unknown values, private notes.
begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'alice@example.test', '{"full_name": "Alice"}'),
  ('22222222-2222-4222-8222-222222222222', 'bob@example.test',   '{"full_name": "Bob"}');

create temp table ctx (id uuid) on commit drop;
grant select, insert on ctx to authenticated, anon;

set local role anon;
select throws_ok(
  $$ select public.save_character(null, 'X', null, null, null, null, null) $$, '42501', null,
  'a visitor cannot create a character'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}';

-- A draft with only a name: everything else stays unknown (NULL), not 0.
insert into ctx select public.save_character(null, '  Lyra  ', '  ', null, null, null, null);
select results_eq(
  'select name, class, level, armor_class, max_hp from public.characters',
  $$ values ('Lyra'::text, null::text, null::integer, null::integer, null::integer) $$,
  'a name-only draft keeps every other value unknown (NULL)'
);
select is((select notes from public.character_private), '', 'notes start empty');

-- Fill in details, including private notes.
select is(
  public.save_character((select id from ctx), 'Lyra', 'Ranger', 3, 15, 24, 'secret backstory'),
  (select id from ctx),
  'saving an existing character returns the same id'
);
select results_eq(
  'select class, level, armor_class, max_hp from public.characters',
  $$ values ('Ranger'::text, 3, 15, 24) $$,
  'details are saved'
);
select is((select notes from public.character_private), 'secret backstory', 'private notes are saved');

-- Clearing a field sets it back to unknown.
select ok(public.save_character((select id from ctx), 'Lyra', 'Ranger', null, 15, 24, 'secret backstory') is not null,
  'saving with the level cleared succeeds');
select is((select level from public.characters), null::integer, 'clearing the level makes it unknown again');

-- Validation.
select throws_ok($$ select public.save_character(null, '', null, null, null, null, null) $$,
  '22023', 'invalid_name', 'a name is required');
select throws_ok($$ select public.save_character(null, 'X', null, 0, null, null, null) $$,
  '22023', 'invalid_level', 'level must be 1-20');
select throws_ok($$ select public.save_character(null, 'X', null, null, 41, null, null) $$,
  '22023', 'invalid_armor_class', 'armor class must be 0-40');
select throws_ok($$ select public.save_character(null, 'X', null, null, null, 0, null) $$,
  '22023', 'invalid_max_hp', 'max HP must be at least 1');
select throws_ok($$ select public.save_character(null, 'X', repeat('a', 61), null, null, null, null) $$,
  '22023', 'invalid_class', 'class is at most 60 characters');
select throws_ok($$ select public.save_character(null, 'X', null, null, null, null, repeat('a', 10001)) $$,
  '22023', 'invalid_notes', 'notes are at most 10000 characters');

select throws_ok(
  $$ update public.characters set name = 'hacked' $$, '42501', null,
  'no direct update of characters'
);
reset role;

-- Bob sees nothing of Alice's and cannot overwrite her character.
set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}';
select is_empty('select 1 from public.characters', 'Bob cannot see Alice''s characters');
select is_empty('select 1 from public.character_private', 'Bob cannot see Alice''s private notes');
select throws_ok(
  $$ select public.save_character((select id from ctx), 'Stolen', null, null, null, null, null) $$,
  'PGRST', '{"code":"character_not_found","message":"character_not_found"}',
  'Bob cannot overwrite Alice''s character and gets not-found'
);
reset role;

select is((select name from public.characters where id = (select id from ctx)), 'Lyra',
  'Alice''s character is unchanged');

set local role anon;
select throws_ok('select 1 from public.characters', '42501', null, 'a visitor cannot read characters');
reset role;

select * from finish();
rollback;
