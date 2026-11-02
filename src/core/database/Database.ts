/**
 * Database singleton using @op-engineering/op-sqlite.
 *
 * Uses `executeSync` throughout — the synchronous JSI API — which matches
 * the pattern expected by the repository layer.  All operations return
 * QueryResult directly (no Promise).
 */
import { open } from '@op-engineering/op-sqlite';
import type { DB } from '@op-engineering/op-sqlite';

let db: DB | null = null;

export function getDb(): DB {
  if (db) return db;
  db = open({ name: 'fieldreporting.db' });
  runMigrations(db);
  return db;
}

// ─── Migrations ───────────────────────────────────────────────────────────────

function runMigrations(database: DB): void {
  database.executeSync('PRAGMA journal_mode = WAL;');
  database.executeSync('PRAGMA foreign_keys = ON;');

  // Version tracking
  database.executeSync(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `);

  const result = database.executeSync(
    'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1;',
  );
  const currentVersion: number = (result.rows?.[0]?.version as number) ?? 0;

  if (currentVersion < 1) {
    applyMigration1(database);
    database.executeSync('INSERT OR REPLACE INTO schema_version (version) VALUES (1);');
  }
}

function applyMigration1(database: DB): void {
  // ── reports ──────────────────────────────────────────────────────────────
  database.executeSync(`
    CREATE TABLE IF NOT EXISTS reports (
      id                   TEXT PRIMARY KEY,
      description          TEXT NOT NULL,
      status               TEXT NOT NULL DEFAULT 'draft',
      idempotency_key      TEXT NOT NULL UNIQUE,
      expected_image_count INTEGER NOT NULL DEFAULT 1,
      server_id            TEXT,
      created_at           TEXT NOT NULL,
      updated_at           TEXT NOT NULL
    );
  `);

  database.executeSync(
    'CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);',
  );

  // ── report_images ─────────────────────────────────────────────────────────
  database.executeSync(`
    CREATE TABLE IF NOT EXISTS report_images (
      id              TEXT PRIMARY KEY,
      report_id       TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      local_path      TEXT NOT NULL,
      storage_path    TEXT,
      original_size   INTEGER NOT NULL DEFAULT 0,
      processed_size  INTEGER NOT NULL DEFAULT 0,
      checksum        TEXT NOT NULL DEFAULT '',
      upload_status   TEXT NOT NULL DEFAULT 'pending'
    );
  `);

  database.executeSync(
    'CREATE INDEX IF NOT EXISTS idx_report_images_report ON report_images(report_id);',
  );

  // ── upload_jobs ───────────────────────────────────────────────────────────
  database.executeSync(`
    CREATE TABLE IF NOT EXISTS upload_jobs (
      id               TEXT PRIMARY KEY,
      report_id        TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      status           TEXT NOT NULL DEFAULT 'pending',
      attempts         INTEGER NOT NULL DEFAULT 0,
      next_attempt_at  TEXT,
      last_error       TEXT,
      generation       INTEGER NOT NULL DEFAULT 0
    );
  `);

  database.executeSync(
    'CREATE INDEX IF NOT EXISTS idx_upload_jobs_status ON upload_jobs(status);',
  );
  database.executeSync(
    'CREATE INDEX IF NOT EXISTS idx_upload_jobs_report ON upload_jobs(report_id);',
  );
}
