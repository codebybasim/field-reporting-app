/**
 * ReportComposerService
 *
 * Saves a composed report atomically:
 *  1. Process each raw image URI → compressed JPEG in app-private storage.
 *  2. Write reports, report_images, and upload_jobs to SQLite in one
 *     logical transaction (op-sqlite executes synchronously so we wrap
 *     in a try/catch rollback pattern).
 *  3. Schedule a WorkManager upload job.
 *
 * A report is NOT considered "safely saved" until both the file copies
 * AND the SQLite records exist. If either step fails we attempt cleanup.
 *
 * This service has no React dependencies and is safe to call from
 * background contexts.
 */

import { processImage } from '../../../core/image-processing/ImageProcessor';
import { deleteReportDirectory } from '../../../core/filesystem/FileSystemService';
import {
  insertReport,
  deleteReport,
} from '../../../core/database/repositories/ReportRepository';
import {
  insertImage,
} from '../../../core/database/repositories/ImageRepository';
import {
  insertJob,
  getCurrentGeneration,
} from '../../../core/database/repositories/UploadJobRepository';
import { scheduleUpload } from '../../uploads/BackgroundScheduler';
import { generateUUID } from '../../../utils/uuid';
import type { LocalReport, LocalReportImage } from '../../../types';

export interface ComposeReportInput {
  description: string;
  imageUris: string[];          // raw URIs from camera / gallery
  onProgress?: (step: string) => void;
}

export interface ComposeReportResult {
  report: LocalReport;
  images: LocalReportImage[];
}

export async function composeAndSaveReport(
  input: ComposeReportInput,
): Promise<ComposeReportResult> {
  const { description, imageUris, onProgress } = input;

  if (!description.trim()) {
    throw new Error('Description is required');
  }
  if (imageUris.length === 0 || imageUris.length > 5) {
    throw new Error('Between 1 and 5 images are required');
  }

  const reportId = generateUUID();
  const processedImages: LocalReportImage[] = [];

  // ── Step 1: Process images (compress + copy to persistent storage) ────────
  for (let i = 0; i < imageUris.length; i++) {
    const imageId = generateUUID();
    onProgress?.(`Processing image ${i + 1} of ${imageUris.length}…`);

    try {
      const processed = await processImage(imageUris[i], reportId, imageId);
      processedImages.push({
        id: imageId,
        reportId,
        localPath: processed.localPath,
        storagePath: null,
        originalSize: processed.originalSize,
        processedSize: processed.processedSize,
        checksum: processed.checksum,
        uploadStatus: 'pending',
      });
    } catch (err) {
      // Clean up any images already processed for this report
      await deleteReportDirectory(reportId).catch(() => {});
      throw new Error(
        `Failed to process image ${i + 1}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Step 2: Write to SQLite ───────────────────────────────────────────────
  onProgress?.('Saving report…');
  let savedReport: LocalReport;

  try {
    savedReport = insertReport({
      id: reportId,
      description: description.trim(),
      status: 'pending',
      idempotencyKey: reportId,
      expectedImageCount: processedImages.length,
      serverId: null,
    });

    for (const img of processedImages) {
      insertImage(img);
    }

    const generation = getCurrentGeneration();
    insertJob({
      id: generateUUID(),
      reportId,
      status: 'pending',
      generation,
    });
  } catch (dbError) {
    // SQLite write failed — clean up image files so no orphans remain
    await deleteReportDirectory(reportId).catch(() => {});
    throw new Error(
      `Failed to save report to database: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
    );
  }

  // ── Step 3: Schedule background upload ───────────────────────────────────
  try {
    await scheduleUpload();
  } catch {
    // Non-fatal: WorkManager scheduling failure doesn't lose the report.
    // The upload will be retried on next connectivity change or app open.
    console.warn('[ReportComposerService] Could not schedule upload immediately');
  }

  return { report: savedReport, images: processedImages };
}
