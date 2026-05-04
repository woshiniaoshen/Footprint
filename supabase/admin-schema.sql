alter table public.profiles
add column if not exists role text not null default 'user';

alter table public.profiles
add column if not exists email text;

create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists profiles_email_idx on public.profiles(email);

create or replace function public.admin_user_accounts()
returns table (
  id uuid,
  email text,
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
    users.created_at,
    users.last_sign_in_at
  from auth.users
  order by users.created_at desc;
end;
$$;

grant execute on function public.admin_user_accounts() to authenticated;

-- Replace this with your admin account's user id from auth.users.
-- update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000000';
