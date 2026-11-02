/**
 * ImageRepository — synchronous SQLite access via op-sqlite executeSync.
 */
import { getDb } from '../Database';
import type { LocalReportImage, ImageUploadStatus } from '../../../types';

function rowToImage(row: Record<string, any>): LocalReportImage {
  return {
    id: row.id as string,
    reportId: row.report_id as string,
    localPath: row.local_path as string,
    storagePath: (row.storage_path as string) ?? null,
    originalSize: row.original_size as number,
    processedSize: row.processed_size as number,
    checksum: row.checksum as string,
    uploadStatus: row.upload_status as ImageUploadStatus,
  };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export function getImagesByReportId(reportId: string): LocalReportImage[] {
  const db = getDb();
  const result = db.executeSync(
    'SELECT * FROM report_images WHERE report_id = ?;',
    [reportId],
  );
  return (result.rows ?? []).map(rowToImage);
}

export function getImageById(id: string): LocalReportImage | null {
  const db = getDb();
  const result = db.executeSync(
    'SELECT * FROM report_images WHERE id = ?;',
    [id],
  );
  const rows = result.rows ?? [];
  return rows.length > 0 ? rowToImage(rows[0]) : null;
}

// ─── Write ────────────────────────────────────────────────────────────────────

export function insertImage(image: LocalReportImage): void {
  const db = getDb();
  db.executeSync(
    `INSERT INTO report_images
       (id, report_id, local_path, storage_path, original_size, processed_size, checksum, upload_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      image.id,
      image.reportId,
      image.localPath,
      image.storagePath,
      image.originalSize,
      image.processedSize,
      image.checksum,
      image.uploadStatus,
    ],
  );
}

export function updateImageUploadStatus(
  id: string,
  status: ImageUploadStatus,
  storagePath?: string,
): void {
  const db = getDb();
  db.executeSync(
    'UPDATE report_images SET upload_status = ?, storage_path = COALESCE(?, storage_path) WHERE id = ?;',
    [status, storagePath ?? null, id],
  );
}

export function deleteImagesByReportId(reportId: string): void {
  const db = getDb();
  db.executeSync('DELETE FROM report_images WHERE report_id = ?;', [reportId]);
}
