-- 0003_billing_entitlements.sql
-- Billing source records + the derived capability table.
--
-- BD-2: provider is Stripe. BD-3: Pro is NOT a single boolean. It is a set of
-- capabilities derived from TWO independent sources:
--   * a recurring SUBSCRIPTION  -> grants the cloud tier (unlimited sync) while active
--   * a one-time perpetual LICENSE -> grants Pro exports forever
-- => entitlements carries capability columns (cloud_tier + pro_export), and a
--    separate `licenses` table sits alongside `subscriptions`.
--
-- CRITICAL INVARIANT (closes BR-02 / OQ-6): a normal authenticated user must be
-- UNABLE to write entitlements / subscriptions / licenses / billing_events.
-- These tables have RLS on with READ-OWN policies only (or zero policies for
-- billing_events). All writes come from the ASP.NET service via the service-role
-- key, which bypasses RLS. There is NO insert/update/delete policy for clients.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
-- cloud_tier capability value (driven by an active subscription).
-- 'free' = quota-limited sync (every signed-in user). 'pro' = unlimited.
create type public.cloud_tier as enum ('free', 'pro');

create type public.subscription_status as enum (
  'trialing', 'active', 'past_due', 'canceled',
  'incomplete', 'incomplete_expired', 'unpaid', 'paused'
);

create type public.license_status as enum ('active', 'refunded', 'revoked');

-- ---------------------------------------------------------------------------
-- subscriptions — one row per Stripe subscription (mode=subscription).
-- The service upserts from webhooks, then recomputes entitlements.
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users (id) on delete cascade,
  provider                 text not null default 'stripe',
  provider_customer_id     text,
  provider_subscription_id text,                 -- Stripe subscription id
  status                   public.subscription_status not null,
  amount_cents             int,
  currency                 char(3),
  current_period_end       timestamptz,          -- feeds entitlements expiry
  cancel_at_period_end     boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  -- Idempotent upsert target for webhook processing.
  unique (provider, provider_subscription_id)
);

create trigger trg_subscriptions_updated
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

create index idx_subscriptions_user on public.subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- licenses — one row per one-time perpetual purchase (Stripe mode=payment).
-- Grants Pro exports forever. Independent of subscription lifecycle: cancelling
-- a subscription must NOT revoke a previously bought license.
-- ---------------------------------------------------------------------------
create table public.licenses (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  provider            text not null default 'stripe',
  provider_customer_id    text,
  -- Stripe PaymentIntent / Checkout Session id for the one-time payment.
  provider_payment_id text,
  -- Optional human-redeemable key, if we ever sell keys standalone.
  license_key         text,
  status              public.license_status not null default 'active',
  amount_cents        int,
  currency            char(3),
  purchased_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Idempotent upsert target for webhook processing of one-time payments.
  unique (provider, provider_payment_id)
);

create trigger trg_licenses_updated
  before update on public.licenses
  for each row execute function public.set_updated_at();

create index idx_licenses_user on public.licenses (user_id);
-- Lookup by key if standalone keys are issued (sparse).
create unique index idx_licenses_key on public.licenses (license_key)
  where license_key is not null;

-- ---------------------------------------------------------------------------
-- entitlements — derived/maintained 1-row-per-user capability record.
-- Replaces the client-trust PremiumService.isPro. CAPABILITY COLUMNS (BD-3):
--   * cloud_tier  -> 'pro' iff an active subscription exists, else 'free'.
--                    Drives the quota check in commit_project_version (0005).
--   * pro_export  -> true iff (active subscription) OR (owns an active license).
--                    Gates Pro exports FEAT-15..19, offline-cacheable.
-- The service recomputes both on every billing event. No single is_pro flag.
-- ---------------------------------------------------------------------------
create table public.entitlements (
  user_id         uuid primary key references auth.users (id) on delete cascade,

  -- Capability: cloud sync quota tier (from active subscription).
  cloud_tier      public.cloud_tier not null default 'free',
  -- When the cloud_tier='pro' grant expires (mirrors subscription.current_period_end).
  -- null while free, or while a subscription is open-ended; defensively re-checked.
  cloud_until     timestamptz,

  -- Capability: Pro exports unlocked (subscription OR perpetual license).
  pro_export      boolean not null default false,

  -- Where the current state came from, for support/debugging.
  source          text,                  -- 'stripe_sub' | 'stripe_license' | 'manual' | 'promo' | 'demo'
  updated_at      timestamptz not null default now()
);

create trigger trg_entitlements_updated
  before update on public.entitlements
  for each row execute function public.set_updated_at();

-- No index beyond PK: always fetched by user_id.

-- ---------------------------------------------------------------------------
-- billing_events — append-only idempotent webhook log. Service-role only.
-- The webhook handler inserts here FIRST, keyed by provider event id; a dup
-- insert is a no-op (idempotency guard against Stripe re-delivery).
-- ---------------------------------------------------------------------------
create table public.billing_events (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null default 'stripe',
  provider_event_id text not null,        -- Stripe event id
  type              text not null,         -- e.g. 'customer.subscription.updated'
  user_id           uuid references auth.users (id) on delete set null,
  payload           jsonb not null,        -- raw event for replay/debug
  processed_at      timestamptz,
  created_at        timestamptz not null default now(),
  unique (provider, provider_event_id)     -- idempotency key
);

create index idx_billing_events_user on public.billing_events (user_id);
create index idx_billing_events_unprocessed
  on public.billing_events (created_at) where processed_at is null;

-- ---------------------------------------------------------------------------
-- Extend the signup hook to also create a default free entitlements row, so a
-- row always exists for every user. Re-create handle_new_user now that
-- entitlements exists (profiles created in 0001).
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

  insert into public.entitlements (user_id)   -- defaults: cloud_tier 'free', pro_export false
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- ===========================================================================
-- RLS — read-own where a "manage billing" screen needs it; NO client writes.
-- Only the service-role key (bypasses RLS) writes these tables.
-- ===========================================================================
alter table public.subscriptions  enable row level security;
alter table public.licenses       enable row level security;
alter table public.entitlements   enable row level security;
alter table public.billing_events enable row level security;

-- entitlements: read own only. NO insert/update/delete policy for clients.
-- => a client can read its tier/capabilities but physically cannot grant them.
create policy entitlements_select_own on public.entitlements
  for select using (user_id = auth.uid());

-- subscriptions: read own only (powers a "manage billing" screen). No writes.
create policy subscriptions_select_own on public.subscriptions
  for select using (user_id = auth.uid());

-- licenses: read own only (so the UI can show "Pro exports owned"). No writes.
create policy licenses_select_own on public.licenses
  for select using (user_id = auth.uid());

-- billing_events: RLS enabled, ZERO policies => no client may select/insert/
-- update/delete. Only the service-role key can touch this table. (Intentional:
-- the webhook audit log is invisible and untouchable from any client session.)

-- ---------------------------------------------------------------------------
-- DOWN (manual rollback):
--   drop table public.billing_events;
--   drop table public.entitlements;
--   drop table public.licenses;
--   drop table public.subscriptions;
--   drop type public.license_status;
--   drop type public.subscription_status;
--   drop type public.cloud_tier;
--   -- and revert handle_new_user() to the 0001 (profile-only) body.
-- ---------------------------------------------------------------------------
