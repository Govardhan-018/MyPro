-- =====================================================================
-- MyPro — extracted PDF text (Roadmap Phase 10.2)
--
-- The raw PDF stays on the device that holds it. Only the structured text
-- JSON produced by on-device extraction is stored here, one object per
-- library item, inside a folder named after its owner:
--
--     pdf-text/<user_id>/<library_item_id>.json
--
-- The bucket is private; clients never hold a Supabase key and reach these
-- objects only through short-lived signed URLs that backend-render issues
-- (see backend-render/src/library/pdf-text.module.ts). `book_details.pdf_json_path`
-- (0001_init.sql) records the object path.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pdf-text', 'pdf-text', false, 52428800, array['application/json'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------
-- Owner-only access, enforced by the first path segment being the uid.
-- storage.objects already has RLS enabled by Supabase.
-- ---------------------------------------------------------------------
drop policy if exists pdf_text_owner_select on storage.objects;
drop policy if exists pdf_text_owner_insert on storage.objects;
drop policy if exists pdf_text_owner_update on storage.objects;
drop policy if exists pdf_text_owner_delete on storage.objects;

create policy pdf_text_owner_select on storage.objects
  for select to authenticated
  using (bucket_id = 'pdf-text' and (storage.foldername(name))[1] = auth.uid()::text);

create policy pdf_text_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'pdf-text' and (storage.foldername(name))[1] = auth.uid()::text);

create policy pdf_text_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'pdf-text' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'pdf-text' and (storage.foldername(name))[1] = auth.uid()::text);

create policy pdf_text_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'pdf-text' and (storage.foldername(name))[1] = auth.uid()::text);
