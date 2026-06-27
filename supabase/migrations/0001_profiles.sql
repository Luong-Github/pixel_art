-- 0001_profiles.sql
-- Foundations: shared trigger + profiles (1:1 with auth.users) + signup hook.
-- Idempotent-ish: uses `create ... if not exists` / `or replace` where Postgres allows.
-- Reversible: down-path documented at the bottom.

-- pgcrypto (gen_random_uuid) is enabled by default on Supabase; ensure it anyway.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at honest on every row update.
-- NOTE: the optimistic-concurrency `version` column on projects is bumped
-- explicitly by the commit_project_version RPC, never by this trigger.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles — app-facing mirror of auth.users. We never expose auth.users to
-- the client; profiles is the readable surface. id is BOTH pk and fk => 1:1.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger trg_profiles_updated
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- No extra indexes: profiles is always looked up by id (= the authed uid).

-- ---------------------------------------------------------------------------
-- Auto-provision a profile (and a free entitlements row, added in 0003) on
-- signup so a row always exists. security definer so the trigger may insert
-- into public tables regardless of the signing-up session's privileges.
-- The entitlements insert is added in 0003 by re-creating this function once
-- entitlements exists; here we only create the profile.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS — owner only. insert allowed as a backstop (the signup trigger normally
-- does it). No delete policy: profile lifecycle follows auth.users (cascade).
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select using (id = auth.uid());

create policy profiles_update_own on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_insert_own on public.profiles
  for insert with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- DOWN (manual rollback) — non-destructive of auth.users:
--   drop trigger on_auth_user_created on auth.users;
--   drop function public.handle_new_user();
--   drop table public.profiles;             -- drops its policies + trigger
--   drop function public.set_updated_at();  -- only after all dependents dropped
-- ---------------------------------------------------------------------------
