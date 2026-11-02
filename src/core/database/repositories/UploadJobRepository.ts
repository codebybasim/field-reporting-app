/**
 * UploadJobRepository — synchronous SQLite access via op-sqlite executeSync.
 */
import { getDb } from '../Database';
import type { UploadJob } from '../../../types';

export type UploadJobWithGeneration = UploadJob & { generation: number };

function rowToJob(row: Record<string, any>): UploadJobWithGeneration {
  return {
    id: row.id as string,
    reportId: row.report_id as string,
    status: row.status as UploadJob['status'],
    attempts: row.attempts as number,
    nextAttemptAt: (row.next_attempt_at as string) ?? null,
    lastError: (row.last_error as string) ?? null,
    generation: (row.generation as number) ?? 0,
  };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export function getPendingJobs(): UploadJobWithGeneration[] {
  const db = getDb();
  const result = db.executeSync(
    "SELECT * FROM upload_jobs WHERE status IN ('pending', 'running') ORDER BY id ASC;",
  );
  return (result.rows ?? []).map(rowToJob);
}

export function getJobByReportId(reportId: string): UploadJobWithGeneration | null {
  const db = getDb();
  const result = db.executeSync(
    'SELECT * FROM upload_jobs WHERE report_id = ?;',
    [reportId],
  );
  const rows = result.rows ?? [];
  return rows.length > 0 ? rowToJob(rows[0]) : null;
}

export function getCurrentGeneration(): number {
  const db = getDb();
  const result = db.executeSync('SELECT MAX(generation) as g FROM upload_jobs;');
  return ((result.rows?.[0]?.g) as number) ?? 0;
}

// ─── Write ────────────────────────────────────────────────────────────────────

export function insertJob(
  job: Pick<UploadJob, 'id' | 'reportId' | 'status'> & { generation: number },
): void {
  const db = getDb();
  db.executeSync(
    `INSERT INTO upload_jobs (id, report_id, status, attempts, next_attempt_at, last_error, generation)
     VALUES (?, ?, ?, 0, NULL, NULL, ?);`,
    [job.id, job.reportId, job.status, job.generation],
  );
}

export function markJobRunning(id: string): void {
  const db = getDb();
  db.executeSync("UPDATE upload_jobs SET status = 'running' WHERE id = ?;", [id]);
}

export function markJobCompleted(id: string): void {
  const db = getDb();
  db.executeSync("UPDATE upload_jobs SET status = 'completed' WHERE id = ?;", [id]);
}

export function markJobFailed(id: string, error: string): void {
  const db = getDb();
  db.executeSync(
    "UPDATE upload_jobs SET status = 'failed', last_error = ? WHERE id = ?;",
    [error, id],
  );
}

export function markJobRetry(id: string, nextAttemptAt: string, error: string): void {
  const db = getDb();
  db.executeSync(
    `UPDATE upload_jobs
     SET status = 'pending', attempts = attempts + 1, next_attempt_at = ?, last_error = ?
     WHERE id = ?;`,
    [nextAttemptAt, error, id],
  );
}

export function deleteAllJobs(): void {
  const db = getDb();
  db.executeSync('DELETE FROM upload_jobs;');
}

/** Bump generation on all pending/running jobs so in-flight workers self-invalidate. */
export function invalidateAllJobs(): void {
  const db = getDb();
  const current = getCurrentGeneration();
  db.executeSync(
    "UPDATE upload_jobs SET generation = ?, status = 'pending' WHERE status IN ('pending', 'running');",
    [current + 1],
  );
}
