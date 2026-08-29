-- 0006_tune_quota.sql
-- Product decisions (signed off 2026-06-29):
--   * Free quota raised 3 -> 25 live projects (growth-first; Pro stays unlimited, added later).
--   * Free total bytes raised 25MB -> 100MB to match 25 projects; per-blob stays 5MB.
--   * create_project() now accepts an optional client-supplied id so a guest's local
--     IndexedDB project keeps ONE id across local <-> cloud (no reconcile step).
--   * get_quota() exposes the same limits + current usage so the client mirrors the
--     server quota in the UI (one source of truth; server still enforces).

-- ---------------------------------------------------------------------------
-- Re-tune quota_limits (same signature -> create or replace is enough).
-- free: 25 live projects, 100 MB total, 5 MB per blob.
-- pro : unlimited projects/total, 25 MB per blob.
-- ---------------------------------------------------------------------------
create or replace function public.quota_limits(p_tier public.cloud_tier)
returns table (
  max_projects   int,
  max_total_bytes bigint,
  max_blob_bytes  bigint
)
language sql
immutable
as $$
  select
    case p_tier when 'pro' then null::int    else 25 end,
    case p_tier when 'pro' then null::bigint else (100 * 1024 * 1024)::bigint end,
    case p_tier when 'pro' then (25 * 1024 * 1024)::bigint
                            else (5  * 1024 * 1024)::bigint end;
$$;

-- ---------------------------------------------------------------------------
-- create_project — now takes an optional p_id (client's local uuid). Drop the
-- old single-arg version first so there is exactly one overload (no ambiguity).
-- Still quota-gated on live-project count; xóa 1 thì được thêm 1.
-- ---------------------------------------------------------------------------
drop function if exists public.create_project(text);

create or replace function public.create_project(
  p_name text default 'Untitled',
  p_id   uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid           uuid := auth.uid();
  v_tier          public.cloud_tier;
  v_lim           record;
  v_project_count int;
  v_id            uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select coalesce(e.cloud_tier, 'free') into v_tier
    from public.entitlements e where e.user_id = v_uid;
  v_tier := coalesce(v_tier, 'free');

  select * into v_lim from public.quota_limits(v_tier);

  if v_lim.max_projects is not null then
    select count(*) into v_project_count
      from public.projects
     where user_id = v_uid and deleted_at is null;

    if v_project_count >= v_lim.max_projects then
      raise exception 'quota_exceeded' using errcode = 'P0004',
        detail = format('%s live projects, limit %s', v_project_count, v_lim.max_projects);
    end if;
  end if;

  insert into public.projects (id, user_id, name)
  values (coalesce(p_id, gen_random_uuid()), v_uid, coalesce(p_name, 'Untitled'))
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- get_quota — current tier + limits + live usage, for the client quota mirror.
-- security definer so it reads entitlements/projects under owner scope only.
-- ---------------------------------------------------------------------------
create or replace function public.get_quota()
returns table (
  tier            public.cloud_tier,
  max_projects    int,
  max_total_bytes bigint,
  max_blob_bytes  bigint,
  used_projects   int,
  used_bytes      bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_tier public.cloud_tier;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select coalesce(e.cloud_tier, 'free') into v_tier
    from public.entitlements e where e.user_id = v_uid;
  v_tier := coalesce(v_tier, 'free');

  return query
  select
    v_tier,
    q.max_projects,
    q.max_total_bytes,
    q.max_blob_bytes,
    (select count(*)::int
       from public.projects p
      where p.user_id = v_uid and p.deleted_at is null),
    (select coalesce(sum(p.blob_bytes), 0)::bigint
       from public.projects p
      where p.user_id = v_uid and p.deleted_at is null)
  from public.quota_limits(v_tier) q;
end;
$$;

grant execute on function public.create_project(text, uuid) to authenticated;
grant execute on function public.get_quota() to authenticated;

-- ---------------------------------------------------------------------------
-- DOWN (manual rollback):
--   drop function if exists public.get_quota();
--   drop function if exists public.create_project(text, uuid);
--   -- then re-apply 0005's create_project(text) + quota_limits if needed.
-- ---------------------------------------------------------------------------
