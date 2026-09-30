-- ═══════════════════════════════════════════════════════════════════════
-- ALTITUDE Trade V8.1 — Synchronisation MetaTrader 5
-- À exécuter UNE fois dans Supabase > SQL Editor (après schema.sql).
-- Idempotent : peut être relancé sans risque. Ne touche à aucune donnée existante.
-- ═══════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- Jetons de synchronisation : seul le hash SHA-256 est stocké.
-- Le jeton en clair n'est affiché qu'une fois dans ALTITUDE, puis collé dans l'EA MT5.
create table if not exists public.sync_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  token_hint text,
  label text not null default 'MetaTrader 5',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists sync_tokens_user_idx on public.sync_tokens(user_id);

-- Boîte de réception : une ligne par position MT5 clôturée, jamais dupliquée.
create table if not exists public.broker_inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'mt5',
  account_login text not null,
  external_id text not null,
  closed_at timestamptz,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  imported_at timestamptz,
  unique (user_id, source, account_login, external_id)
);
create index if not exists broker_inbox_user_created_idx on public.broker_inbox(user_id, created_at desc);

-- Dernier état connu de chaque compte MT5 (solde, equity, serveur).
create table if not exists public.broker_accounts (
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'mt5',
  account_login text not null,
  server text,
  company text,
  name text,
  currency text,
  balance numeric,
  equity numeric,
  ea_version text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, source, account_login)
);

alter table public.sync_tokens enable row level security;
alter table public.broker_inbox enable row level security;
alter table public.broker_accounts enable row level security;

-- sync_tokens : l'utilisateur gère ses propres jetons (création, liste, révocation).
drop policy if exists "sync_tokens_select_own" on public.sync_tokens;
create policy "sync_tokens_select_own" on public.sync_tokens for select to authenticated using (auth.uid() = user_id);
drop policy if exists "sync_tokens_insert_own" on public.sync_tokens;
create policy "sync_tokens_insert_own" on public.sync_tokens for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "sync_tokens_update_own" on public.sync_tokens;
create policy "sync_tokens_update_own" on public.sync_tokens for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "sync_tokens_delete_own" on public.sync_tokens;
create policy "sync_tokens_delete_own" on public.sync_tokens for delete to authenticated using (auth.uid() = user_id);

-- broker_inbox : lecture + marquage « importé » par l'utilisateur. L'écriture vient
-- uniquement de l'Edge Function mt5-ingest (service role).
drop policy if exists "broker_inbox_select_own" on public.broker_inbox;
create policy "broker_inbox_select_own" on public.broker_inbox for select to authenticated using (auth.uid() = user_id);
drop policy if exists "broker_inbox_update_own" on public.broker_inbox;
create policy "broker_inbox_update_own" on public.broker_inbox for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "broker_accounts_select_own" on public.broker_accounts;
create policy "broker_accounts_select_own" on public.broker_accounts for select to authenticated using (auth.uid() = user_id);

grant select, insert, update, delete on public.sync_tokens to authenticated;
grant select on public.broker_inbox to authenticated;
grant update (imported_at) on public.broker_inbox to authenticated;
grant select on public.broker_accounts to authenticated;

-- Compatibilité si la table existait déjà sans first_seen_at.
alter table public.broker_accounts add column if not exists first_seen_at timestamptz not null default now();
