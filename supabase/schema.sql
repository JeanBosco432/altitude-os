-- ALTITUDE OS — Supabase production schema
-- Run this once in Supabase > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  plan text not null default 'free' check (plan in ('free','pro','lifetime','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Reserved for future paid plans. Stripe/webhook code should update this table with service-role only.
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'stripe',
  provider_customer_id text,
  provider_subscription_id text unique,
  status text not null default 'inactive',
  price_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.user_states enable row level security;
alter table public.subscriptions enable row level security;

-- Users can read their own profile. Plan/role changes are intentionally not client-writable.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (auth.uid() = id);

-- A user's complete ALTITUDE OS state is private to that authenticated user.
drop policy if exists "user_states_select_own" on public.user_states;
create policy "user_states_select_own" on public.user_states
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "user_states_insert_own" on public.user_states;
create policy "user_states_insert_own" on public.user_states
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "user_states_update_own" on public.user_states;
create policy "user_states_update_own" on public.user_states
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "user_states_delete_own" on public.user_states;
create policy "user_states_delete_own" on public.user_states
  for delete to authenticated using (auth.uid() = user_id);

-- Users can see their own billing state, but only backend/service-role can modify it.
drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own" on public.subscriptions
  for select to authenticated using (auth.uid() = user_id);

-- Create profile/state automatically on signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  insert into public.user_states (user_id, state)
  values (new.id, '{}'::jsonb)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Private screenshot bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trade-media', 'trade-media', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false, file_size_limit=5242880, allowed_mime_types=array['image/jpeg','image/png','image/webp'];

-- Path format: <user_uuid>/<trade_id>/<before|after>.jpg
-- foldername(name)[1] is the user's UUID string.
drop policy if exists "trade_media_select_own" on storage.objects;
create policy "trade_media_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'trade-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "trade_media_insert_own" on storage.objects;
create policy "trade_media_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'trade-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "trade_media_update_own" on storage.objects;
create policy "trade_media_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'trade-media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'trade-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "trade_media_delete_own" on storage.objects;
create policy "trade_media_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'trade-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- Least privilege grants for browser clients.
grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.user_states to authenticated;
grant select on public.subscriptions to authenticated;
