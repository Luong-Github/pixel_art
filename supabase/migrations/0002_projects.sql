-- 0002_projects.sql
-- projects — cloud-sync metadata (server side of the IndexedDB `meta` store).
-- NO pixel payload here; the gzip'd PixelArtProjectFile lives in Storage
-- (bucket project-blobs, see 0004). This row must stay cheap: it is what the
-- library list() returns.

create table public.projects (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  name              text not null default 'Untitled',

  -- Storage pointers (see 0004). The bytes are NOT stored in Postgres.
  -- e.g. 'projects/<user_id>/<id>/v<version>.json.gz'
  blob_path         text,
  blob_bytes        bigint not null default 0,
  -- e.g. 'thumbnails/<user_id>/<id>.png'
  thumb_path        text,

  -- Denormalized stats for the library UI without fetching the blob.
  workspace_count   int not null default 1,
  frame_count       int not null default 1,

  -- Sync (see 0005).
  version           int not null default 1,
  client_updated_at timestamptz,            -- last client-side edit time (display / merge UX)
  deleted_at        timestamptz,            -- soft delete

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger trg_projects_updated
  before update on public.projects
  for each row execute function public.set_updated_at();

-- The one real access pattern: a user's live projects, newest first
-- (matches list()'s sort by updatedAt desc). Partial index excludes trash.
create index idx_projects_user_live
  on public.projects (user_id, updated_at desc)
  where deleted_at is null;

-- Quota counting + future trash view by user.
create index idx_projects_user_deleted
  on public.projects (user_id, deleted_at);

-- ---------------------------------------------------------------------------
-- RLS — owner only. Soft delete = update set deleted_at (covered by update
-- policy); the listing filters deleted_at is null. Hard delete policy kept for
-- "empty trash". No cross-user read path exists. (Public sharing is later.)
-- ---------------------------------------------------------------------------
alter table public.projects enable row level security;

create policy projects_select_own on public.projects
  for select using (user_id = auth.uid());

create policy projects_insert_own on public.projects
  for insert with check (user_id = auth.uid());

create policy projects_update_own on public.projects
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy projects_delete_own on public.projects
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- DOWN (manual rollback):
--   drop table public.projects;  -- drops its policies, indexes, trigger
-- ---------------------------------------------------------------------------
