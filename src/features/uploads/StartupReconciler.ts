/**
 * StartupReconciler
 *
 * Runs once at application startup to detect and recover inconsistent state.
 *
 * Scenarios handled:
 *
 *  A) "Uploading" reports whose process was killed mid-upload:
 *     → Reset status to 'pending' so they are retried.
 *
 *  B) Reports with missing local image files:
 *     → Mark the report as 'failed' with a clear message.
 *     → The user can see the error in the Outbox and take action.
 *     → We NEVER silently delete failed reports.
 *
 *  C) Orphaned image directories (directory on disk, no matching DB record):
 *     → Delete the orphaned files (they will never be uploaded).
 *
 *  D) Pending jobs due for retry:
 *     → Schedule a WorkManager upload attempt.
 *
 * All operations are defensive: a failure in one check does not block others.
 */

import {
  getAllReports,
  updateReportStatus,
} from '../../core/database/repositories/ReportRepository';
import { getImagesByReportId } from '../../core/database/repositories/ImageRepository';
import {
  getPendingJobs,
  markJobFailed,
} from '../../core/database/repositories/UploadJobRepository';
import {
  findMissingFiles,
  listReportDirectories,
  deleteReportDirectory,
} from '../../core/filesystem/FileSystemService';
import { scheduleUpload } from './BackgroundScheduler';
import { Platform } from 'react-native';

export async function runStartupReconciliation(): Promise<void> {
  console.log('[StartupReconciler] Running startup reconciliation…');

  try {
    await reconcileUploadingReports();
  } catch (e) {
    console.warn('[StartupReconciler] reconcileUploadingReports error', e);
  }

  try {
    await reconcileMissingFiles();
  } catch (e) {
    console.warn('[StartupReconciler] reconcileMissingFiles error', e);
  }

  try {
    await reconcileOrphanedDirectories();
  } catch (e) {
    console.warn('[StartupReconciler] reconcileOrphanedDirectories error', e);
  }

  try {
    await maybeScheduleRetry();
  } catch (e) {
    console.warn('[StartupReconciler] maybeScheduleRetry error', e);
  }

  console.log('[StartupReconciler] Complete');
}

// ─── A) Reset stuck "uploading" reports ──────────────────────────────────────

async function reconcileUploadingReports(): Promise<void> {
  const reports = getAllReports();
  for (const report of reports) {
    if (report.status === 'uploading') {
      console.log(`[StartupReconciler] Resetting stuck-uploading report ${report.id}`);
      updateReportStatus(report.id, 'pending');
    }
  }
}

// ─── B) Reports with missing image files ─────────────────────────────────────

async function reconcileMissingFiles(): Promise<void> {
  const reports = getAllReports().filter(
    r => r.status === 'pending' || r.status === 'failed',
  );

  for (const report of reports) {
    const images = getImagesByReportId(report.id);
    if (images.length === 0) continue;

    const missingIds = await findMissingFiles(
      images.map(img => ({ id: img.id, localPath: img.localPath })),
    );

    if (missingIds.length > 0) {
      const msg = `${missingIds.length} of ${images.length} image file(s) missing from device storage`;
      console.warn(`[StartupReconciler] Report ${report.id}: ${msg}`);
      updateReportStatus(report.id, 'failed');
      // Mark the job failed too so the outbox shows the error
      const { getJobByReportId, markJobFailed: failJob } = require('../../core/database/repositories/UploadJobRepository');
      const job = getJobByReportId(report.id);
      if (job && job.status !== 'completed' && job.status !== 'failed') {
        failJob(job.id, msg);
      }
    }
  }
}

// ─── C) Orphaned directories ──────────────────────────────────────────────────

async function reconcileOrphanedDirectories(): Promise<void> {
  const diskDirs = await listReportDirectories();
  const dbReportIds = new Set(getAllReports().map(r => r.id));

  for (const dirName of diskDirs) {
    if (!dbReportIds.has(dirName)) {
      console.log(`[StartupReconciler] Deleting orphaned directory: ${dirName}`);
      await deleteReportDirectory(dirName).catch(e =>
        console.warn(`[StartupReconciler] Could not delete orphan ${dirName}`, e),
      );
    }
  }
}

// ─── D) Schedule retry if pending work exists ────────────────────────────────

async function maybeScheduleRetry(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const pending = getPendingJobs();
  if (pending.length > 0) {
    console.log(`[StartupReconciler] ${pending.length} pending job(s) — scheduling upload`);
    await scheduleUpload().catch(e =>
      console.warn('[StartupReconciler] scheduleUpload failed', e),
    );
  }
}
