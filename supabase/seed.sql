-- seed.sql — LOCAL / DEV ONLY. Run by `supabase db reset` after migrations.
-- NOT a migration; never applied to production. Never put real keys/secrets here
-- (Stripe/test keys live in env, not in SQL).
--
-- Creates two test users directly in auth.users (local GoTrue accepts this), then
-- exercises both capability paths so gating can be tested in the UI:
--   alice  -> free      : cloud_tier=free, pro_export=false (default)
--   bob    -> sub + lic : cloud_tier=pro (active subscription) AND pro_export=true
--                         (active subscription OR owned license)
-- The on_auth_user_created trigger auto-creates each profile + a free entitlements
-- row; we then simulate the service recomputing bob's capabilities.

-- Fixed UUIDs so blob/thumb paths and re-runs stay stable.
\set alice_id '11111111-1111-1111-1111-111111111111'
\set bob_id   '22222222-2222-2222-2222-222222222222'

-- --- auth.users (local dev; password = 'password123' for both) ---------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
values
  (:'alice_id', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'alice@example.com', crypt('password123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"name":"Alice (free)"}', now(), now()),
  (:'bob_id', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bob@example.com', crypt('password123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"name":"Bob (pro)"}', now(), now())
on conflict (id) do nothing;

-- Identity rows so email login works in local GoTrue.
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values
  (gen_random_uuid(), :'alice_id', :'alice_id',
   format('{"sub":"%s","email":"alice@example.com"}', :'alice_id')::jsonb, 'email', now(), now(), now()),
  (gen_random_uuid(), :'bob_id', :'bob_id',
   format('{"sub":"%s","email":"bob@example.com"}', :'bob_id')::jsonb, 'email', now(), now(), now())
on conflict do nothing;

-- The signup trigger created profiles + free entitlements for both. Backstop in
-- case the trigger is disabled locally.
insert into public.profiles (id, display_name) values
  (:'alice_id', 'Alice (free)'),
  (:'bob_id',   'Bob (pro)')
on conflict (id) do nothing;

insert into public.entitlements (user_id) values (:'alice_id'), (:'bob_id')
on conflict (user_id) do nothing;

-- --- Simulate the billing service: give Bob an active subscription + a license,
--     then recompute his entitlements capabilities (cloud_tier + pro_export). ---
insert into public.subscriptions
  (user_id, provider, provider_customer_id, provider_subscription_id, status,
   amount_cents, currency, current_period_end, cancel_at_period_end)
values
  (:'bob_id', 'stripe', 'cus_devbob', 'sub_devbob', 'active',
   500, 'USD', now() + interval '30 days', false)
on conflict (provider, provider_subscription_id) do nothing;

insert into public.licenses
  (user_id, provider, provider_customer_id, provider_payment_id, status, amount_cents, currency)
values
  (:'bob_id', 'stripe', 'cus_devbob', 'pi_devbob', 'active', 1500, 'USD')
on conflict (provider, provider_payment_id) do nothing;

update public.entitlements
   set cloud_tier  = 'pro',
       cloud_until = now() + interval '30 days',
       pro_export  = true,
       source      = 'stripe_sub'
 where user_id = :'bob_id';

-- --- Sample projects (dummy pointers; no real bytes needed for schema tests) ---
insert into public.projects
  (id, user_id, name, blob_path, blob_bytes, thumb_path, workspace_count, frame_count, version, client_updated_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', :'alice_id', 'Alice sprite',
   format('projects/%s/aaaaaaaa-0000-0000-0000-000000000001/v1.json.gz', :'alice_id'), 2048,
   format('thumbnails/%s/aaaaaaaa-0000-0000-0000-000000000001.png', :'alice_id'), 1, 4, 1, now()),
  ('bbbbbbbb-0000-0000-0000-000000000001', :'bob_id', 'Bob animation',
   format('projects/%s/bbbbbbbb-0000-0000-0000-000000000001/v1.json.gz', :'bob_id'), 8192,
   format('thumbnails/%s/bbbbbbbb-0000-0000-0000-000000000001.png', :'bob_id'), 2, 12, 1, now())
on conflict (id) do nothing;
