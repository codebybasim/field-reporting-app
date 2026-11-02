/**
 * ReportRepository — synchronous SQLite access via op-sqlite executeSync.
 */
import { getDb } from '../Database';
import type { LocalReport, ReportStatus } from '../../../types';

function now(): string {
  return new Date().toISOString();
}

function rowToReport(row: Record<string, any>): LocalReport {
  return {
    id: row.id as string,
    description: row.description as string,
    status: row.status as ReportStatus,
    idempotencyKey: row.idempotency_key as string,
    expectedImageCount: row.expected_image_count as number,
    serverId: (row.server_id as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export function getAllReports(): LocalReport[] {
  const db = getDb();
  const result = db.executeSync('SELECT * FROM reports ORDER BY created_at DESC;');
  return (result.rows ?? []).map(rowToReport);
}

export function getReportById(id: string): LocalReport | null {
  const db = getDb();
  const result = db.executeSync('SELECT * FROM reports WHERE id = ?;', [id]);
  const rows = result.rows ?? [];
  return rows.length > 0 ? rowToReport(rows[0]) : null;
}

export function getPendingReports(): LocalReport[] {
  const db = getDb();
  const result = db.executeSync(
    "SELECT * FROM reports WHERE status IN ('pending', 'uploading') ORDER BY created_at ASC;",
  );
  return (result.rows ?? []).map(rowToReport);
}

export function countLocalReports(): number {
  const db = getDb();
  const result = db.executeSync(
    "SELECT COUNT(*) as c FROM reports WHERE status NOT IN ('uploaded');",
  );
  return ((result.rows?.[0]?.c) as number) ?? 0;
}

// ─── Write ────────────────────────────────────────────────────────────────────

export function insertReport(
  report: Omit<LocalReport, 'createdAt' | 'updatedAt'>,
): LocalReport {
  const db = getDb();
  const ts = now();
  db.executeSync(
    `INSERT INTO reports
       (id, description, status, idempotency_key, expected_image_count, server_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      report.id,
      report.description,
      report.status,
      report.idempotencyKey,
      report.expectedImageCount,
      report.serverId,
      ts,
      ts,
    ],
  );
  return { ...report, createdAt: ts, updatedAt: ts };
}

export function updateReportStatus(
  id: string,
  status: ReportStatus,
  serverId?: string,
): void {
  const db = getDb();
  db.executeSync(
    'UPDATE reports SET status = ?, server_id = COALESCE(?, server_id), updated_at = ? WHERE id = ?;',
    [status, serverId ?? null, now(), id],
  );
}

export function deleteReport(id: string): void {
  const db = getDb();
  db.executeSync('DELETE FROM reports WHERE id = ?;', [id]);
}

export function deleteAllReports(): void {
  const db = getDb();
  db.executeSync('DELETE FROM reports;');
}
