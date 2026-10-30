create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_username_case_insensitive_key
  on public.profiles (lower(username));

alter table public.profiles enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'Users can read their own profile'
  ) then
    create policy "Users can read their own profile"
      on public.profiles for select
      to authenticated
      using ((select auth.uid()) = id);
  end if;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate text;
begin
  candidate := coalesce(
    new.raw_user_meta_data ->> 'username',
    new.raw_user_meta_data ->> 'user_name',
    new.raw_user_meta_data ->> 'preferred_username',
    split_part(coalesce(new.email, 'user'), '@', 1)
  );
  candidate := left(regexp_replace(candidate, '[^A-Za-z0-9_]', '', 'g'), 20);
  if length(candidate) < 3 then
    candidate := 'user_' || substring(new.id::text, 1, 8);
  end if;
  if exists (
    select 1 from public.profiles
    where lower(username) = lower(candidate) and id <> new.id
  ) then
    candidate := left(candidate, 11) || '_' || substring(replace(new.id::text, '-', ''), 1, 8);
  end if;
  insert into public.profiles (id, username)
  values (new.id, candidate)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

insert into public.profiles (id, username)
select
  users.id,
  left(candidate.username, 11) || '_' || substring(replace(users.id::text, '-', ''), 1, 8)
from auth.users as users
cross join lateral (
  select left(
    regexp_replace(
      coalesce(
        users.raw_user_meta_data ->> 'username',
        users.raw_user_meta_data ->> 'user_name',
        users.raw_user_meta_data ->> 'preferred_username',
        split_part(coalesce(users.email, 'user'), '@', 1)
      ),
      '[^A-Za-z0-9_]',
      '',
      'g'
    ),
    20
  ) as username
) as candidate
where not exists (
  select 1 from public.profiles where profiles.id = users.id
)
on conflict (id) do nothing;

create table if not exists public.sites (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  template text not null,
  site_data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.sites enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'sites'
      and policyname = 'Users can read their own sites'
  ) then
    create policy "Users can read their own sites"
      on public.sites for select
      to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'sites'
      and policyname = 'Users can insert their own sites'
  ) then
    create policy "Users can insert their own sites"
      on public.sites for insert
      to authenticated
      with check ((select auth.uid()) = user_id);
  end if;
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'sites'
      and policyname = 'Users can update their own sites'
  ) then
    create policy "Users can update their own sites"
      on public.sites for update
      to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'sites'
      and policyname = 'Users can delete their own sites'
  ) then
    create policy "Users can delete their own sites"
      on public.sites for delete
      to authenticated
      using ((select auth.uid()) = user_id);
  end if;
end;
$$;

grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.sites to authenticated;

notify pgrst, 'reload schema';
