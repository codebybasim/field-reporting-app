/**
 * UploadCoordinator
 *
 * Singleton service responsible for durable, idempotent report delivery.
 *
 * Design invariants:
 *  - Pure TypeScript: no React imports, no hooks, no component lifecycle.
 *  - Dependency-injected: constructor accepts repository and API objects so
 *    unit tests can substitute fakes without any native modules.
 *  - Single active queue run at a time (guarded by _running flag).
 *  - Generation-aware: checks the job's stored generation against the
 *    current value before writing progress, so a reset mid-flight is safe.
 *
 * Upload workflow per report:
 *  1. Create report on server (idempotent — reuses existing if key matches).
 *  2. For each image:
 *     a. Upload binary to Supabase Storage (409 Conflict = already there, OK).
 *     b. Register image metadata with server (idempotent upsert).
 *  3. Finalize report (server checks image count, marks 'finalized').
 *  4. Mark local report as 'uploaded'.
 *
 * Error handling:
 *  - Retryable errors → markJobRetry with backoff timestamp.
 *  - Permanent errors  → markJobFailed; report set to 'failed' (never deleted).
 *  - Jobs whose nextAttemptAt is in the future are skipped until due.
 */

import {
  getPendingJobs,
  getJobByReportId,
  markJobRunning,
  markJobCompleted,
  markJobFailed,
  markJobRetry,
  getCurrentGeneration,
  type UploadJobWithGeneration,
} from '../../core/database/repositories/UploadJobRepository';
import {
  getReportById,
  updateReportStatus,
} from '../../core/database/repositories/ReportRepository';
import {
  getImagesByReportId,
  updateImageUploadStatus,
} from '../../core/database/repositories/ImageRepository';
import {
  classifyError,
  nextRetryAt,
  hasExceededMaxAttempts,
} from './RetryPolicy';
import {
  createReport,
  uploadImageToStorage,
  registerImage,
  finalizeReport,
} from '../../services/api/ReportApiService';
import type { LocalReport, LocalReportImage } from '../../types';

// ─── Interfaces for dependency injection (used by tests) ─────────────────────

export interface IReportApi {
  createReport: typeof createReport;
  uploadImageToStorage: typeof uploadImageToStorage;
  registerImage: typeof registerImage;
  finalizeReport: typeof finalizeReport;
}

export interface IUploadCoordinatorDeps {
  api?: IReportApi;
  /** Override clock for deterministic tests */
  now?: () => string;
  /** Called after every job state change so the UI can re-read from SQLite */
  onJobStateChange?: () => void;
}

// ─── Coordinator ──────────────────────────────────────────────────────────────

export class UploadCoordinator {
  private static _instance: UploadCoordinator | null = null;
  private _running = false;
  private readonly _api: IReportApi;
  private readonly _now: () => string;
  private readonly _onJobStateChange: () => void;

  static getInstance(deps?: IUploadCoordinatorDeps): UploadCoordinator {
    if (!UploadCoordinator._instance) {
      UploadCoordinator._instance = new UploadCoordinator(deps);
    }
    return UploadCoordinator._instance;
  }

  /** For tests — replace the singleton with a fresh instance */
  static resetInstance(): void {
    UploadCoordinator._instance = null;
  }

  constructor(deps?: IUploadCoordinatorDeps) {
    this._api = deps?.api ?? {
      createReport,
      uploadImageToStorage,
      registerImage,
      finalizeReport,
    };
    this._now = deps?.now ?? (() => new Date().toISOString());
    this._onJobStateChange = deps?.onJobStateChange ?? (() => { });
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Process all pending upload jobs.
   * Runs serially to avoid concurrent uploads for the same report.
   * Safe to call multiple times; concurrent calls are no-ops.
   */
  async processQueue(): Promise<void> {
    if (this._running) {
      console.log('[UploadCoordinator] Already running, skipping');
      return;
    }
    this._running = true;
    try {
      await this._runQueue();
    } finally {
      this._running = false;
    }
  }

  /**
   * Reset: invalidate in-flight jobs and stop processing.
   * Actual DB/file cleanup is done by ResetService; we just stop the queue.
   */
  async reset(): Promise<void> {
    this._running = false;
    console.log('[UploadCoordinator] Reset — queue cleared');
  }

  get isRunning(): boolean {
    return this._running;
  }

  // ─── Private queue runner ────────────────────────────────────────────────────

  private async _runQueue(): Promise<void> {
    const jobs = getPendingJobs();
    if (jobs.length === 0) {
      console.log('[UploadCoordinator] No pending jobs');
      return;
    }

    console.log(`[UploadCoordinator] Processing ${jobs.length} job(s)`);
    const currentGeneration = getCurrentGeneration();

    for (const job of jobs) {
      if (!this._running) break; // reset was called

      // Skip jobs from a previous queue generation (reset happened)
      if (job.generation < currentGeneration) {
        console.log(`[UploadCoordinator] Skipping stale job ${job.id} (gen ${job.generation} < ${currentGeneration})`);
        continue;
      }

      // Respect backoff: skip if not yet due
      if (job.nextAttemptAt && new Date(job.nextAttemptAt) > new Date(this._now())) {
        console.log(`[UploadCoordinator] Job ${job.id} not due until ${job.nextAttemptAt}`);
        continue;
      }

      await this._processJob(job);
    }
  }

  private async _processJob(job: UploadJobWithGeneration): Promise<void> {
    const report = getReportById(job.reportId);
    if (!report) {
      console.warn(`[UploadCoordinator] Report ${job.reportId} not found, marking job failed`);
      markJobFailed(job.id, 'Report record not found in local database');
      this._onJobStateChange();
      return;
    }

    console.log(`[UploadCoordinator] Starting job ${job.id} for report ${report.id}`);
    markJobRunning(job.id);
    updateReportStatus(report.id, 'uploading');
    this._onJobStateChange(); // → UI shows "Uploading…"

    try {
      await this._uploadReport(report, job);
      markJobCompleted(job.id);
      updateReportStatus(report.id, 'uploaded');
      this._onJobStateChange(); // → UI shows "Delivered ✓"
      console.log(`[UploadCoordinator] Report ${report.id} uploaded successfully`);
    } catch (error) {
      this._handleJobError(job, error);
      this._onJobStateChange(); // → UI shows retry timestamp or "Needs attention"
    }
  }

  // ─── Upload workflow ─────────────────────────────────────────────────────────

  private async _uploadReport(
    report: LocalReport,
    job: UploadJobWithGeneration,
  ): Promise<void> {
    // ── Step 1: Create report on server (idempotent) ─────────────────────────
    const serverReport = await this._api.createReport({
      idempotencyKey: report.idempotencyKey,
      description: report.description,
      expectedImageCount: report.expectedImageCount,
    });

    // Persist server ID so subsequent retries skip re-creation
    if (!report.serverId || report.serverId !== serverReport.id) {
      updateReportStatus(report.id, 'uploading', serverReport.id);
    }

    const serverId = serverReport.id;

    // ── Step 2: Upload each image ─────────────────────────────────────────────
    const images = getImagesByReportId(report.id);
    if (images.length === 0) {
      throw Object.assign(
        new Error('Report has no images — cannot finalize'),
        { httpStatus: 400 },
      );
    }

    for (const image of images) {
      if (!this._running) throw new Error('Upload cancelled by reset');
      await this._uploadImage(serverId, image);
    }

    // ── Step 3: Finalize ──────────────────────────────────────────────────────
    await this._api.finalizeReport({ reportId: serverId });
  }

  private async _uploadImage(
    serverId: string,
    image: LocalReportImage,
  ): Promise<void> {
    // Already uploaded — skip (idempotent retry safety)
    if (image.uploadStatus === 'uploaded') {
      console.log(`[UploadCoordinator] Image ${image.id} already uploaded, skipping`);
      return;
    }

    const storagePath = `reports/${serverId}/${image.id}.jpg`;
    updateImageUploadStatus(image.id, 'uploading');

    // ── a) Upload binary to Storage ──────────────────────────────────────────
    // 409 Conflict from Storage means the file is already there — we continue
    // to the register step to ensure metadata is recorded.
    await this._api.uploadImageToStorage({
      storagePath,
      fileUri: image.localPath,
      fileSizeBytes: image.processedSize,
    });

    // ── b) Register metadata (idempotent upsert on server) ───────────────────
    await this._api.registerImage({
      reportId: serverId,
      clientImageId: image.id,
      storagePath,
      checksum: image.checksum,
      fileSize: image.processedSize,
    });

    updateImageUploadStatus(image.id, 'uploaded', storagePath);
    console.log(`[UploadCoordinator] Image ${image.id} uploaded and registered`);
  }

  // ─── Error handling ──────────────────────────────────────────────────────────

  private _handleJobError(job: UploadJobWithGeneration, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const classification = classifyError(error);
    const newAttempts = job.attempts + 1;

    console.warn(
      `[UploadCoordinator] Job ${job.id} failed (attempt ${newAttempts}, ${classification}): ${message}`,
    );

    if (classification === 'permanent' || hasExceededMaxAttempts(newAttempts)) {
      const reason = hasExceededMaxAttempts(newAttempts)
        ? `Max attempts (${newAttempts}) reached: ${message}`
        : message;
      markJobFailed(job.id, reason);
      updateReportStatus(job.reportId, 'failed');
      console.error(`[UploadCoordinator] Report ${job.reportId} permanently failed: ${reason}`);
      return;
    }

    const retryAt = nextRetryAt(newAttempts, error);
    if (!retryAt) {
      markJobFailed(job.id, message);
      updateReportStatus(job.reportId, 'failed');
      return;
    }

    markJobRetry(job.id, retryAt, message);
    updateReportStatus(job.reportId, 'pending');
    console.log(`[UploadCoordinator] Job ${job.id} scheduled for retry at ${retryAt}`);
  }
}
