-- T04a: personal character library with private notes (AC-02 first half; A06, A16).
--
-- Unknown values stay NULL, never 0 (AC-02). save_character REPLACES every field
-- on each call: NULL clears a field. Private notes live in their own owner-only
-- table so later campaign/DM reads can never include them (A16).
--
-- Errors: auth_required (42501), invalid_name / invalid_class / invalid_level /
-- invalid_armor_class / invalid_max_hp / invalid_notes (22023),
-- character_not_found (PGRST custom error, HTTP 404).

create table public.characters (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 100 and name = btrim(name)),
  class       text check (class is null or (char_length(class) between 1 and 60 and class = btrim(class))),
  level       integer check (level is null or level between 1 and 20),
  armor_class integer check (armor_class is null or armor_class between 0 and 40),
  max_hp      integer check (max_hp is null or max_hp between 1 and 999),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index characters_owner_idx on public.characters (owner_id);

create table public.character_private (
  character_id uuid primary key references public.characters (id) on delete cascade,
  notes        text not null default '' check (char_length(notes) <= 10000),
  updated_at   timestamptz not null default now()
);

alter table public.characters enable row level security;
alter table public.character_private enable row level security;

grant select on public.characters to authenticated;
grant select on public.character_private to authenticated;

create policy characters_select_own
  on public.characters for select to authenticated
  using (owner_id = (select auth.uid()));

create policy character_private_select_own
  on public.character_private for select to authenticated
  using (exists (
    select 1 from public.characters c
     where c.id = character_id and c.owner_id = (select auth.uid())
  ));

-- Create (p_id null) or replace (p_id = own character). Returns the id.
create function public.save_character(
  p_id          uuid,
  p_name        text,
  p_class       text,
  p_level       integer,
  p_armor_class integer,
  p_max_hp      integer,
  p_notes       text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := auth.uid();
  v_name  text := btrim(coalesce(p_name, ''));
  v_class text := nullif(btrim(coalesce(p_class, '')), '');
  v_notes text := coalesce(p_notes, '');
  v_id    uuid;
begin
  if v_user is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 100 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if v_class is not null and char_length(v_class) > 60 then
    raise exception 'invalid_class' using errcode = '22023';
  end if;
  if p_level is not null and p_level not between 1 and 20 then
    raise exception 'invalid_level' using errcode = '22023';
  end if;
  if p_armor_class is not null and p_armor_class not between 0 and 40 then
    raise exception 'invalid_armor_class' using errcode = '22023';
  end if;
  if p_max_hp is not null and p_max_hp not between 1 and 999 then
    raise exception 'invalid_max_hp' using errcode = '22023';
  end if;
  if char_length(v_notes) > 10000 then
    raise exception 'invalid_notes' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.characters (owner_id, name, class, level, armor_class, max_hp)
    values (v_user, v_name, v_class, p_level, p_armor_class, p_max_hp)
    returning id into v_id;
    insert into public.character_private (character_id, notes) values (v_id, v_notes);
  else
    update public.characters
       set name = v_name, class = v_class, level = p_level,
           armor_class = p_armor_class, max_hp = p_max_hp, updated_at = now()
     where id = p_id and owner_id = v_user
    returning id into v_id;
    if v_id is null then
      raise sqlstate 'PGRST' using
        message = '{"code":"character_not_found","message":"character_not_found"}',
        detail  = '{"status":404,"headers":{}}';
    end if;
    insert into public.character_private (character_id, notes) values (v_id, v_notes)
    on conflict (character_id) do update set notes = excluded.notes, updated_at = now();
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_character(uuid, text, text, integer, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.save_character(uuid, text, text, integer, integer, integer, text)
  to authenticated;
