create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);

create unique index profiles_username_case_insensitive_key
  on public.profiles (lower(username));

alter table public.profiles enable row level security;

create policy "Users can read their own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create function public.handle_new_user()
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
    candidate := left(candidate, 13) || '_' || substring(replace(new.id::text, '-', ''), 1, 6);
  end if;
  insert into public.profiles (id, username)
  values (new.id, candidate);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create table public.sites (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  template text not null,
  site_data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.sites enable row level security;

create policy "Users can read their own sites"
  on public.sites for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own sites"
  on public.sites for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own sites"
  on public.sites for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own sites"
  on public.sites for delete
  to authenticated
  using ((select auth.uid()) = user_id);

grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.sites to authenticated;

notify pgrst, 'reload schema';
