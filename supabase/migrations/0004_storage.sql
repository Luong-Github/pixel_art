-- 0004_storage.sql
-- Two PRIVATE Storage buckets + their RLS policies (RLS lives on storage.objects).
--   project-blobs : gzip'd PixelArtProjectFile, versioned -> projects/<uid>/<pid>/v<n>.json.gz
--   thumbnails    : small PNG previews                   -> thumbnails/<uid>/<pid>.png
-- Both private; the library grid renders thumbnails via short-TTL signed URLs.
--
-- Ownership rule: the uid is the SECOND path segment (segment 1 = the
-- 'projects'/'thumbnails' prefix, segment 2 = the user's uid). storage.foldername(name)
-- is 1-indexed, so (storage.foldername(name))[2] = auth.uid()::text scopes a user
-- to their own folder for all of select/insert/update/delete.

insert into storage.buckets (id, name, public)
values ('project-blobs', 'project-blobs', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('thumbnails', 'thumbnails', false)
on conflict (id) do nothing;

-- project-blobs: full CRUD on own folder only.
create policy blobs_select_own on storage.objects
  for select using (
    bucket_id = 'project-blobs'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy blobs_insert_own on storage.objects
  for insert with check (
    bucket_id = 'project-blobs'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy blobs_update_own on storage.objects
  for update using (
    bucket_id = 'project-blobs'
    and (storage.foldername(name))[2] = auth.uid()::text
  ) with check (
    bucket_id = 'project-blobs'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy blobs_delete_own on storage.objects
  for delete using (
    bucket_id = 'project-blobs'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- thumbnails: same ownership rule.
create policy thumbs_select_own on storage.objects
  for select using (
    bucket_id = 'thumbnails'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy thumbs_insert_own on storage.objects
  for insert with check (
    bucket_id = 'thumbnails'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy thumbs_update_own on storage.objects
  for update using (
    bucket_id = 'thumbnails'
    and (storage.foldername(name))[2] = auth.uid()::text
  ) with check (
    bucket_id = 'thumbnails'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy thumbs_delete_own on storage.objects
  for delete using (
    bucket_id = 'thumbnails'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- SECURITY NOTE (flagged for the security-auditor): do NOT make these buckets
-- public to implement sharing. The future public-share feature must copy/publish
-- into a dedicated public surface (a public-shares bucket) or a token-gated
-- shares table — never by loosening project-blobs/thumbnails. (OD-5.)

-- ---------------------------------------------------------------------------
-- DOWN (manual rollback) — note objects must be empty first:
--   drop policy thumbs_delete_own  on storage.objects;
--   drop policy thumbs_update_own  on storage.objects;
--   drop policy thumbs_insert_own  on storage.objects;
--   drop policy thumbs_select_own  on storage.objects;
--   drop policy blobs_delete_own   on storage.objects;
--   drop policy blobs_update_own   on storage.objects;
--   drop policy blobs_insert_own   on storage.objects;
--   drop policy blobs_select_own   on storage.objects;
--   delete from storage.buckets where id in ('project-blobs','thumbnails');
-- ---------------------------------------------------------------------------
