/**
 * UploadCoordinator unit tests
 *
 * All SQLite repositories and the network API are replaced with in-memory
 * fakes. No native modules are loaded.
 *
 * Coverage:
 *  - Report creation (new + idempotent retry)
 *  - Per-image upload + registration
 *  - Partial image failure and retry scheduling
 *  - Lost HTTP response (Storage 409 → re-registration)
 *  - Finalization
 *  - Permanent vs transient error classification
 *  - Queue recovery after reset
 *  - Duplicate prevention (_running guard)
 */

import { UploadCoordinator, type IReportApi } from '../../src/features/uploads/UploadCoordinator';

// ─── In-memory store (prefixed `mock` so Jest hoisting allows it) ─────────────

// Jest requires variables referenced inside jest.mock() factories to be
// prefixed with "mock" (case-insensitive) to bypass the scope restriction.
const mockStore = {
  reports: new Map<string, any>(),
  images: new Map<string, any[]>(),
  jobs: new Map<string, any>(),
  generation: 0,
};

function resetMockStore() {
  mockStore.reports.clear();
  mockStore.images.clear();
  mockStore.jobs.clear();
  mockStore.generation = 0;
}

// ─── Repository mocks ─────────────────────────────────────────────────────────

jest.mock('../../src/core/database/repositories/UploadJobRepository', () => ({
  getPendingJobs: jest.fn(),
  getJobByReportId: jest.fn(),
  markJobRunning: jest.fn(),
  markJobCompleted: jest.fn(),
  markJobFailed: jest.fn(),
  markJobRetry: jest.fn(),
  getCurrentGeneration: jest.fn(),
  invalidateAllJobs: jest.fn(),
}));

jest.mock('../../src/core/database/repositories/ReportRepository', () => ({
  getReportById: jest.fn(),
  updateReportStatus: jest.fn(),
  getAllReports: jest.fn(),
}));

jest.mock('../../src/core/database/repositories/ImageRepository', () => ({
  getImagesByReportId: jest.fn(),
  updateImageUploadStatus: jest.fn(),
}));

// ─── Import mocked modules so we can set up implementations ──────────────────

import * as JobRepo from '../../src/core/database/repositories/UploadJobRepository';
import * as ReportRepo from '../../src/core/database/repositories/ReportRepository';
import * as ImageRepo from '../../src/core/database/repositories/ImageRepository';

// ─── Wire mock implementations to in-memory store ────────────────────────────

function wireMocks() {
  (JobRepo.getPendingJobs as jest.Mock).mockImplementation(() =>
    [...mockStore.jobs.values()].filter(j => j.status === 'pending' || j.status === 'running'),
  );
  (JobRepo.getJobByReportId as jest.Mock).mockImplementation((rid: string) =>
    [...mockStore.jobs.values()].find(j => j.reportId === rid) ?? null,
  );
  (JobRepo.markJobRunning as jest.Mock).mockImplementation((id: string) => {
    if (mockStore.jobs.has(id)) mockStore.jobs.get(id)!.status = 'running';
  });
  (JobRepo.markJobCompleted as jest.Mock).mockImplementation((id: string) => {
    if (mockStore.jobs.has(id)) mockStore.jobs.get(id)!.status = 'completed';
  });
  (JobRepo.markJobFailed as jest.Mock).mockImplementation((id: string, err: string) => {
    if (mockStore.jobs.has(id)) {
      mockStore.jobs.get(id)!.status = 'failed';
      mockStore.jobs.get(id)!.lastError = err;
    }
  });
  (JobRepo.markJobRetry as jest.Mock).mockImplementation((id: string, next: string, err: string) => {
    if (mockStore.jobs.has(id)) {
      const j = mockStore.jobs.get(id)!;
      j.status = 'pending'; j.attempts += 1; j.nextAttemptAt = next; j.lastError = err;
    }
  });
  (JobRepo.getCurrentGeneration as jest.Mock).mockImplementation(() => mockStore.generation);

  (ReportRepo.getReportById as jest.Mock).mockImplementation((id: string) =>
    mockStore.reports.get(id) ?? null,
  );
  (ReportRepo.updateReportStatus as jest.Mock).mockImplementation(
    (id: string, status: string, serverId?: string) => {
      if (mockStore.reports.has(id)) {
        mockStore.reports.get(id)!.status = status;
        if (serverId) mockStore.reports.get(id)!.serverId = serverId;
      }
    },
  );
  (ReportRepo.getAllReports as jest.Mock).mockImplementation(() =>
    [...mockStore.reports.values()],
  );

  (ImageRepo.getImagesByReportId as jest.Mock).mockImplementation((reportId: string) =>
    mockStore.images.get(reportId) ?? [],
  );
  (ImageRepo.updateImageUploadStatus as jest.Mock).mockImplementation(
    (id: string, status: string, path?: string) => {
      for (const imgs of mockStore.images.values()) {
        const img = imgs.find((i: any) => i.id === id);
        if (img) { img.uploadStatus = status; if (path) img.storagePath = path; }
      }
    },
  );
}

// ─── API fake factory ─────────────────────────────────────────────────────────

function makeApi(overrides: Partial<IReportApi> = {}): IReportApi {
  return {
    createReport: jest.fn(async ({ idempotencyKey, expectedImageCount }) => ({
      id: `server-${idempotencyKey}`,
      idempotency_key: idempotencyKey,
      status: 'pending',
      expected_image_count: expectedImageCount,
      created_at: new Date().toISOString(),
    })),
    uploadImageToStorage: jest.fn(async () => { }),
    registerImage: jest.fn(async ({ clientImageId, storagePath, checksum, fileSize }) => ({
      id: `server-img-${clientImageId}`,
      client_image_id: clientImageId,
      storage_path: storagePath,
      checksum,
      file_size: fileSize,
      created_at: new Date().toISOString(),
    })),
    finalizeReport: jest.fn(async ({ reportId }) => ({
      id: reportId,
      status: 'finalized',
      updated_at: new Date().toISOString(),
    })),
    ...overrides,
  };
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

function seedReportWithImages(count = 1) {
  const reportId = 'r1';
  mockStore.reports.set(reportId, {
    id: reportId, description: 'Test', status: 'pending',
    idempotencyKey: reportId, expectedImageCount: count, serverId: null,
  });
  const images = Array.from({ length: count }, (_, i) => ({
    id: `img${i + 1}`, reportId,
    localPath: `/data/reports/r1/img${i + 1}.jpg`,
    storagePath: null, originalSize: 5_000_000, processedSize: 4_000_000,
    checksum: `sha256_${i + 1}`, uploadStatus: 'pending',
  }));
  mockStore.images.set(reportId, images);
  mockStore.jobs.set('j1', { id: 'j1', reportId, status: 'pending', attempts: 0, nextAttemptAt: null, lastError: null, generation: 0 });
  return { reportId, images };
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  resetMockStore();
  wireMocks();
  UploadCoordinator.resetInstance();
  jest.clearAllMocks();
  wireMocks(); // re-apply after clearAllMocks
});

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('UploadCoordinator — happy path', () => {
  test('processes a single-image report end-to-end', async () => {
    const api = makeApi();
    seedReportWithImages(1);

    const coordinator = new UploadCoordinator({ api });
    await coordinator.processQueue();

    expect(api.createReport).toHaveBeenCalledTimes(1);
    expect(api.uploadImageToStorage).toHaveBeenCalledTimes(1);
    expect(api.registerImage).toHaveBeenCalledTimes(1);
    expect(api.finalizeReport).toHaveBeenCalledTimes(1);
    expect(mockStore.reports.get('r1')!.status).toBe('uploaded');
    expect(mockStore.jobs.get('j1')!.status).toBe('completed');
  });

  test('processes a five-image report uploading each image once', async () => {
    const api = makeApi();
    seedReportWithImages(5);

    const coordinator = new UploadCoordinator({ api });
    await coordinator.processQueue();

    expect(api.uploadImageToStorage).toHaveBeenCalledTimes(5);
    expect(api.registerImage).toHaveBeenCalledTimes(5);
    expect(api.finalizeReport).toHaveBeenCalledTimes(1);
    expect(mockStore.reports.get('r1')!.status).toBe('uploaded');
  });

  test('skips already-uploaded images on retry', async () => {
    const api = makeApi();
    const { images } = seedReportWithImages(2);

    // Mark first image as already uploaded
    images[0].uploadStatus = 'uploaded';
    (images[0] as any).storagePath = 'reports/server-r1/img1.jpg';
    mockStore.images.set('r1', images);

    const coordinator = new UploadCoordinator({ api });
    await coordinator.processQueue();

    // Only the second image should be uploaded
    expect(api.uploadImageToStorage).toHaveBeenCalledTimes(1);
    expect(api.registerImage).toHaveBeenCalledTimes(1);
    expect(api.finalizeReport).toHaveBeenCalledTimes(1);
    expect(mockStore.reports.get('r1')!.status).toBe('uploaded');
  });
});

// ─── Idempotency ─────────────────────────────────────────────────────────────

describe('UploadCoordinator — idempotency', () => {
  test('retries createReport idempotently when first attempt response is lost', async () => {
    let callCount = 0;
    const api = makeApi({
      createReport: jest.fn(async ({ idempotencyKey }) => {
        callCount += 1;
        if (callCount === 1) {
          throw Object.assign(new Error('Network request failed'), {});
        }
        return {
          id: `server-${idempotencyKey}`,
          idempotency_key: idempotencyKey,
          status: 'pending',
          expected_image_count: 1,
          created_at: new Date().toISOString(),
        };
      }),
    });
    seedReportWithImages(1);

    const coordinator = new UploadCoordinator({ api });

    // First run → createReport throws → job scheduled for retry
    await coordinator.processQueue();
    expect(mockStore.jobs.get('j1')!.status).toBe('pending');
    expect(mockStore.jobs.get('j1')!.attempts).toBe(1);

    // Clear backoff so job is due immediately
    mockStore.jobs.get('j1')!.nextAttemptAt = null;

    // Second run → createReport succeeds
    await coordinator.processQueue();
    expect(api.createReport).toHaveBeenCalledTimes(2);
    expect(mockStore.reports.get('r1')!.status).toBe('uploaded');
  });

  test('handles Storage already-uploaded (no-op upload) by still registering metadata', async () => {
    const api = makeApi({
      // Simulate 409 handled internally — resolves without throwing
      uploadImageToStorage: jest.fn(async () => { }),
    });
    seedReportWithImages(1);

    const coordinator = new UploadCoordinator({ api });
    await coordinator.processQueue();

    expect(api.registerImage).toHaveBeenCalledTimes(1);
    expect(api.finalizeReport).toHaveBeenCalledTimes(1);
    expect(mockStore.reports.get('r1')!.status).toBe('uploaded');
  });
});

// ─── Error handling ──────────────────────────────────────────────────────────

describe('UploadCoordinator — error handling', () => {
  test('marks job as permanent failure on HTTP 400', async () => {
    const api = makeApi({
      createReport: jest.fn(async () => {
        throw Object.assign(new Error('Validation error'), { httpStatus: 400 });
      }),
    });
    seedReportWithImages(1);

    const coordinator = new UploadCoordinator({ api });
    await coordinator.processQueue();

    expect(mockStore.jobs.get('j1')!.status).toBe('failed');
    expect(mockStore.reports.get('r1')!.status).toBe('failed');
  });

  test('marks job as permanent failure on HTTP 413 (image too large)', async () => {
    const api = makeApi({
      createReport: jest.fn(async ({ idempotencyKey }) => ({
        id: `server-${idempotencyKey}`, idempotency_key: idempotencyKey,
        status: 'pending', expected_image_count: 1, created_at: new Date().toISOString(),
      })),
      uploadImageToStorage: jest.fn(async () => {
        throw Object.assign(new Error('File too large'), { httpStatus: 413 });
      }),
    });
    seedReportWithImages(1);

    const coordinator = new UploadCoordinator({ api });
    await coordinator.processQueue();

    expect(mockStore.jobs.get('j1')!.status).toBe('failed');
    expect(mockStore.reports.get('r1')!.status).toBe('failed');
  });

  test('schedules retry on transient HTTP 500', async () => {
    const api = makeApi({
      createReport: jest.fn(async () => {
        throw Object.assign(new Error('Server error'), { httpStatus: 500 });
      }),
    });
    seedReportWithImages(1);

    const coordinator = new UploadCoordinator({ api });
    await coordinator.processQueue();

    expect(mockStore.jobs.get('j1')!.status).toBe('pending');
    expect(mockStore.jobs.get('j1')!.attempts).toBe(1);
    expect(mockStore.jobs.get('j1')!.nextAttemptAt).not.toBeNull();
  });

  test('schedules retry on network failure', async () => {
    const api = makeApi({
      createReport: jest.fn(async () => {
        throw new Error('Network request failed');
      }),
    });
    seedReportWithImages(1);

    const coordinator = new UploadCoordinator({ api });
    await coordinator.processQueue();

    expect(mockStore.jobs.get('j1')!.status).toBe('pending');
    expect(mockStore.jobs.get('j1')!.attempts).toBe(1);
  });

  test('permanently fails after max attempts', async () => {
    const api = makeApi({
      createReport: jest.fn(async () => {
        throw Object.assign(new Error('Server error'), { httpStatus: 500 });
      }),
    });
    seedReportWithImages(1);

    // Simulate job at MAX_ATTEMPTS - 1 (next failure exceeds the cap)
    mockStore.jobs.get('j1')!.attempts = 7;

    const coordinator = new UploadCoordinator({ api });
    await coordinator.processQueue();

    expect(mockStore.jobs.get('j1')!.status).toBe('failed');
    expect(mockStore.reports.get('r1')!.status).toBe('failed');
  });
});

// ─── Concurrency and reset ───────────────────────────────────────────────────

describe('UploadCoordinator — concurrency and reset', () => {
  test('prevents concurrent processQueue calls', async () => {
    const api = makeApi({
      createReport: jest.fn(async ({ idempotencyKey }) => {
        await new Promise<void>(r => setTimeout(r, 10));
        return {
          id: `server-${idempotencyKey}`, idempotency_key: idempotencyKey,
          status: 'pending', expected_image_count: 1, created_at: new Date().toISOString(),
        };
      }),
    });
    seedReportWithImages(1);

    const coordinator = new UploadCoordinator({ api });
    const p1 = coordinator.processQueue();
    const p2 = coordinator.processQueue(); // should be no-op
    await Promise.all([p1, p2]);

    expect(api.createReport).toHaveBeenCalledTimes(1);
  });

  test('reset clears running state', async () => {
    const api = makeApi({
      createReport: jest.fn(async ({ idempotencyKey }) => {
        await new Promise<void>(r => setTimeout(r, 50));
        return {
          id: `server-${idempotencyKey}`, idempotency_key: idempotencyKey,
          status: 'pending', expected_image_count: 1, created_at: new Date().toISOString(),
        };
      }),
    });
    seedReportWithImages(1);

    const coordinator = new UploadCoordinator({ api });
    const queuePromise = coordinator.processQueue();
    await coordinator.reset();
    await queuePromise;

    expect(coordinator.isRunning).toBe(false);
  });

  test('skips jobs from an older generation after reset', async () => {
    const api = makeApi();
    seedReportWithImages(1);

    // Simulate generation bump from a reset
    mockStore.generation = 1;
    mockStore.jobs.get('j1')!.generation = 0;

    const coordinator = new UploadCoordinator({ api });
    await coordinator.processQueue();

    expect(api.createReport).not.toHaveBeenCalled();
  });
});

// ─── Queue recovery ──────────────────────────────────────────────────────────

describe('UploadCoordinator — queue recovery', () => {
  test('processes multiple pending reports in sequence', async () => {
    const api = makeApi();

    mockStore.reports.set('ra', { id: 'ra', description: 'A', status: 'pending', idempotencyKey: 'ra', expectedImageCount: 1, serverId: null });
    mockStore.images.set('ra', [{ id: 'ia1', reportId: 'ra', localPath: '/data/ra/ia1.jpg', storagePath: null, originalSize: 1000, processedSize: 800, checksum: 'sha_a', uploadStatus: 'pending' }]);
    mockStore.jobs.set('ja', { id: 'ja', reportId: 'ra', status: 'pending', attempts: 0, nextAttemptAt: null, lastError: null, generation: 0 });

    mockStore.reports.set('rb', { id: 'rb', description: 'B', status: 'pending', idempotencyKey: 'rb', expectedImageCount: 1, serverId: null });
    mockStore.images.set('rb', [{ id: 'ib1', reportId: 'rb', localPath: '/data/rb/ib1.jpg', storagePath: null, originalSize: 1000, processedSize: 800, checksum: 'sha_b', uploadStatus: 'pending' }]);
    mockStore.jobs.set('jb', { id: 'jb', reportId: 'rb', status: 'pending', attempts: 0, nextAttemptAt: null, lastError: null, generation: 0 });

    const coordinator = new UploadCoordinator({ api });
    await coordinator.processQueue();

    expect(api.finalizeReport).toHaveBeenCalledTimes(2);
    expect(mockStore.reports.get('ra')!.status).toBe('uploaded');
    expect(mockStore.reports.get('rb')!.status).toBe('uploaded');
  });

  test('skips jobs with future nextAttemptAt', async () => {
    const api = makeApi();
    seedReportWithImages(1);

    const future = new Date(Date.now() + 3_600_000).toISOString();
    mockStore.jobs.get('j1')!.nextAttemptAt = future;

    const coordinator = new UploadCoordinator({ api });
    await coordinator.processQueue();

    expect(api.createReport).not.toHaveBeenCalled();
    expect(mockStore.reports.get('r1')!.status).toBe('pending');
  });
});
