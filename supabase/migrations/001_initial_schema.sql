-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 001: Initial schema
-- Run this in your Supabase SQL editor or via the Supabase CLI:
--   supabase db push
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable UUID extension (already enabled on Supabase by default)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── reports ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The client supplies its own UUID as the idempotency key.
  -- This column drives effectively-once creation.
  idempotency_key  UUID NOT NULL UNIQUE,
  description      TEXT NOT NULL CHECK (char_length(description) > 0),
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'uploading', 'finalized', 'failed')),
  expected_image_count INT NOT NULL CHECK (expected_image_count BETWEEN 1 AND 5),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── report_images ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS report_images (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The client supplies its own UUID for each image; drives idempotency.
  client_image_id UUID NOT NULL,
  report_id       UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  storage_path    TEXT NOT NULL,    -- e.g. reports/{reportId}/{imageId}.jpg
  checksum        TEXT NOT NULL,    -- SHA-256 hex
  file_size       BIGINT NOT NULL CHECK (file_size > 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Prevent duplicate registrations for the same (report, image) pair
  UNIQUE (report_id, client_image_id),
  -- Also prevent duplicate storage paths
  UNIQUE (storage_path)
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_reports_status        ON reports(status);
CREATE INDEX IF NOT EXISTS idx_report_images_report  ON report_images(report_id);

-- ─── Auto-update updated_at ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER reports_updated_at
  BEFORE UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Row Level Security ───────────────────────────────────────────────────────
-- The mobile app uses the anon key and calls Edge Functions.
-- Direct table access is granted only to service_role (Edge Functions run as
-- service_role).  Anon users cannot read or write tables directly.

ALTER TABLE reports       ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_images ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically in Supabase — no policy needed.
-- Anon key: allow nothing directly (all writes go through Edge Functions).
-- Anon key: allow reading finalized reports for the Server Reports screen.
CREATE POLICY "anon_read_finalized_reports"
  ON reports FOR SELECT
  TO anon
  USING (status = 'finalized');

CREATE POLICY "anon_read_report_images"
  ON report_images FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM reports r
      WHERE r.id = report_images.report_id AND r.status = 'finalized'
    )
  );
