alter table public.profiles
add column if not exists role text not null default 'user';

alter table public.profiles
add column if not exists email text;

create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists profiles_email_idx on public.profiles(email);

create or replace function public.global_heatmap_locations()
returns table (
  id bigint,
  lat double precision,
  lon double precision,
  place text
)
language sql
security definer
set search_path = public
as $$
  select
    locations.id,
    locations.lat,
    locations.lon,
    locations.place
  from public.locations
  where locations.lat is not null
    and locations.lon is not null
  order by locations.created_at desc;
$$;

grant execute on function public.global_heatmap_locations() to authenticated, anon;

drop function if exists public.admin_user_accounts();

create or replace function public.admin_user_accounts()
returns table (
  id uuid,
  email text,
  username text,
  avatar_url text,
  role text,
  has_profile boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  ) then
    raise exception 'Admin access required';
  end if;

  return query
  select
    users.id,
    users.email::text,
    profiles.username,
    profiles.avatar_url,
    coalesce(profiles.role, 'user')::text,
    (profiles.id is not null) as has_profile,
    users.created_at,
    users.last_sign_in_at
  from auth.users
  left join public.profiles on profiles.id = users.id
  order by users.created_at desc;
end;
$$;

grant execute on function public.admin_user_accounts() to authenticated;

create or replace function public.admin_backfill_missing_profiles()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  inserted_count integer;
begin
  if not exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  ) then
    raise exception 'Admin access required';
  end if;

  insert into public.profiles (id, username, email, avatar_url, role)
  select
    users.id,
    lower(
      left(regexp_replace(split_part(coalesce(users.email, 'user'), '@', 1), '[^a-zA-Z0-9_]', '_', 'g'), 12)
      || '_'
      || left(replace(users.id::text, '-', ''), 6)
    ) as username,
    users.email::text,
    'data:image/svg+xml;base64,' || encode(convert_to(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">' ||
      '<rect width="128" height="128" rx="64" fill="#182235"/>' ||
      '<circle cx="96" cy="30" r="14" fill="#F2C36B"/>' ||
      '<path d="M14 92 45 48l22 30 16-20 31 34v22H14z" fill="#42D9B8"/>' ||
      '<path d="M45 48 57 65l-16-5zm38 10 13 15-18-6z" fill="#F7F3EA"/>' ||
      '<text x="64" y="78" text-anchor="middle" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="#111827">' ||
      upper(left(coalesce(users.email, 'user'), 1)) ||
      '</text></svg>',
      'UTF8'
    ), 'base64'),
    'user'
  from auth.users
  where not exists (
    select 1
    from public.profiles
    where profiles.id = users.id
  )
  on conflict (id) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

grant execute on function public.admin_backfill_missing_profiles() to authenticated;

-- Replace this with your admin account's user id from auth.users.
-- update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000000';
