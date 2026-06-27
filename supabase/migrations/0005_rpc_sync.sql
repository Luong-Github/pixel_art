-- 0005_rpc_sync.sql
-- Sync RPCs: quota check + optimistic-concurrency commit + soft delete.
--
-- BD-1: cloud sync is quota-GATED BY TIER, not Pro-gated. Every signed-in user
-- (even free) can sync within quota; pro = unlimited. Quota reads
-- entitlements.cloud_tier. Over-quota raises a typed exception the client turns
-- into a clear toast (never a silent fail).
--
-- All quota limits below are TUNABLE defaults (OD-1) — sign off before launch.

-- ---------------------------------------------------------------------------
-- Quota limits per tier. Returned as a row so the RPC and any future
-- "GET /quota" surface share one source of truth. Pro caps are NULL = unlimited.
-- Defaults (TUNABLE):
--   free: 3 live projects, 25 MB total, 5 MB per blob.
--   pro : unlimited projects/total, 25 MB per blob (sane upload ceiling).
-- ---------------------------------------------------------------------------
create or replace function public.quota_limits(p_tier public.cloud_tier)
returns table (
  max_projects   int,      -- null = unlimited
  max_total_bytes bigint,  -- null = unlimited
  max_blob_bytes  bigint   -- null = unlimited
)
language sql
immutable
as $$
  select
    case p_tier when 'pro' then null::int    else 3 end,
    case p_tier when 'pro' then null::bigint else (25 * 1024 * 1024)::bigint end,
    case p_tier when 'pro' then (25 * 1024 * 1024)::bigint
                            else (5  * 1024 * 1024)::bigint end;
$$;

-- ---------------------------------------------------------------------------
-- commit_project_version — the ONLY write path for project blob pointers.
-- security definer so it can enforce version + quota atomically and prevent the
-- client from setting blob_path to an arbitrary value via a raw UPDATE.
--
-- Flow (see DATA-MODEL §2/§5):
--   1. client uploads gzip blob to v<version+1>.json.gz (RLS-scoped, 0004)
--   2. client calls this RPC with the version it loaded (expected_version)
-- Behaviour:
--   * row missing / not owner            -> 'not_found'
--   * version mismatch (another device)  -> 'version_conflict' (loser reloads)
--   * over quota                         -> 'quota_exceeded' / 'blob_too_large'
--   * ok -> version++, pointers+stats updated, returns the new version.
-- ---------------------------------------------------------------------------
create or replace function public.commit_project_version(
  p_project_id       uuid,
  p_expected_version int,
  p_blob_path        text,
  p_blob_bytes       bigint,
  p_thumb_path       text         default null,
  p_workspace_count  int          default null,
  p_frame_count      int          default null,
  p_client_updated_at timestamptz default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_tier         public.cloud_tier;
  v_cur_version  int;
  v_cur_bytes    bigint;
  v_lim          record;
  v_project_count int;
  v_total_bytes   bigint;
  v_new_version  int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Resolve tier (default free if no row, though handle_new_user guarantees one).
  select coalesce(e.cloud_tier, 'free')
    into v_tier
    from public.entitlements e
   where e.user_id = v_uid;
  v_tier := coalesce(v_tier, 'free');

  select * into v_lim from public.quota_limits(v_tier);

  -- Per-blob ceiling (applies to all tiers).
  if v_lim.max_blob_bytes is not null and p_blob_bytes > v_lim.max_blob_bytes then
    raise exception 'blob_too_large' using errcode = 'P0001',
      detail = format('blob %s bytes exceeds limit %s', p_blob_bytes, v_lim.max_blob_bytes);
  end if;

  -- Lock the target row (own + live) and read its current state.
  select version, blob_bytes
    into v_cur_version, v_cur_bytes
    from public.projects
   where id = p_project_id
     and user_id = v_uid
     and deleted_at is null
   for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- Optimistic concurrency: refuse if another device advanced the version.
  if v_cur_version <> p_expected_version then
    raise exception 'version_conflict' using errcode = 'P0003',
      detail = format('expected %s, current %s', p_expected_version, v_cur_version);
  end if;

  -- Quota: count live projects + total bytes for this user, accounting for the
  -- delta this commit introduces (new blob replaces the current one in-place).
  if v_lim.max_total_bytes is not null then
    select count(*), coalesce(sum(blob_bytes), 0)
      into v_project_count, v_total_bytes
      from public.projects
     where user_id = v_uid
       and deleted_at is null;

    -- This project already counted; swap its old size for the new one.
    if (v_total_bytes - v_cur_bytes + p_blob_bytes) > v_lim.max_total_bytes then
      raise exception 'quota_exceeded' using errcode = 'P0004',
        detail = format('total would be %s bytes, limit %s',
                        v_total_bytes - v_cur_bytes + p_blob_bytes, v_lim.max_total_bytes);
    end if;
    -- max_projects is enforced at insert/create time (create_project below);
    -- a commit on an existing project does not change the project count.
  end if;

  v_new_version := v_cur_version + 1;

  update public.projects
     set version           = v_new_version,
         blob_path          = p_blob_path,
         blob_bytes         = p_blob_bytes,
         thumb_path         = coalesce(p_thumb_path, thumb_path),
         workspace_count    = coalesce(p_workspace_count, workspace_count),
         frame_count        = coalesce(p_frame_count, frame_count),
         client_updated_at  = coalesce(p_client_updated_at, client_updated_at)
         -- updated_at bumped by trg_projects_updated
   where id = p_project_id
     and user_id = v_uid;

  return v_new_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_project — gate the live-project COUNT quota at creation time, then
-- insert an owned row. Returns the new project id. (commit_project_version
-- handles byte quota on subsequent saves.) security definer for the same reason.
-- ---------------------------------------------------------------------------
create or replace function public.create_project(
  p_name text default 'Untitled'
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

  insert into public.projects (user_id, name)
  values (v_uid, coalesce(p_name, 'Untitled'))
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- soft_delete_project — set deleted_at (reversible by the client via restore).
-- Owner-scoped. The listing already hides deleted rows. "Empty trash" is a hard
-- delete done by the service (it also removes Storage objects).
-- ---------------------------------------------------------------------------
create or replace function public.soft_delete_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  update public.projects
     set deleted_at = now()
   where id = p_project_id
     and user_id = v_uid
     and deleted_at is null;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- restore_project — undo a soft delete within the trash window. Frees a quota
-- slot back, so it is also count-gated to avoid bypassing max_projects.
create or replace function public.restore_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid           uuid := auth.uid();
  v_tier          public.cloud_tier;
  v_lim           record;
  v_project_count int;
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
      raise exception 'quota_exceeded' using errcode = 'P0004';
    end if;
  end if;

  update public.projects
     set deleted_at = null
   where id = p_project_id
     and user_id = v_uid
     and deleted_at is not null;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Execute grants: these RPCs are the client's write path; allow authenticated.
-- (They are security definer and enforce auth.uid() ownership internally.)
grant execute on function public.commit_project_version(uuid, int, text, bigint, text, int, int, timestamptz) to authenticated;
grant execute on function public.create_project(text)        to authenticated;
grant execute on function public.soft_delete_project(uuid)   to authenticated;
grant execute on function public.restore_project(uuid)       to authenticated;
grant execute on function public.quota_limits(public.cloud_tier) to authenticated;

-- ---------------------------------------------------------------------------
-- DOWN (manual rollback):
--   drop function public.restore_project(uuid);
--   drop function public.soft_delete_project(uuid);
--   drop function public.create_project(text);
--   drop function public.commit_project_version(uuid, int, text, bigint, text, int, int, timestamptz);
--   drop function public.quota_limits(public.cloud_tier);
-- ---------------------------------------------------------------------------
