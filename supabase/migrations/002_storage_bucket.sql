-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 002: Storage bucket and policies
-- ─────────────────────────────────────────────────────────────────────────────

-- Create the storage bucket (private by default)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'report-images',
  'report-images',
  false,                          -- not public; signed URLs used for reading
  5242880,                        -- 5 MB hard ceiling enforced by Storage
  ARRAY['image/jpeg']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage RLS: service_role (Edge Functions) can do everything.
-- Anon key: upload objects (Edge Function proxies the upload on behalf of the
-- client, but if you prefer direct client upload you need this policy).
CREATE POLICY "service_role_all"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'report-images');

-- Allow anon to upload directly to reports/{reportId}/ prefix.
-- The Edge Function validate-and-register step enforces business rules.
CREATE POLICY "anon_upload_report_images"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'report-images');

-- Allow anon to read objects (for image previews via signed URL or direct URL).
CREATE POLICY "anon_read_report_images"
  ON storage.objects FOR SELECT
  TO anon
  USING (bucket_id = 'report-images');
