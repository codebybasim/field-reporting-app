/**
 * BackgroundScheduler
 *
 * Two-layer upload triggering:
 *
 * 1. Immediate (app alive): starts a react-native-background-actions
 *    foreground service that runs UploadCoordinator.processQueue() in a loop.
 *    This keeps the JS running even when the app is backgrounded, with a
 *    persistent notification.
 *
 * 2. Backup (app killed): enqueues a WorkManager one-time job.  When
 *    WorkManager fires and the app is not running, UploadWorker simply
 *    starts the main activity (brings app to foreground).  The app's
 *    AppBootProvider then runs StartupReconciler which triggers the upload.
 *
 * IMPORTANT: Heavy imports (UploadCoordinator, BackgroundService) are lazy
 * so the Supabase client and native modules are NOT loaded at app launch.
 * They are only require()'d when scheduleUpload() is actually called.
 */

import { Platform } from 'react-native';

let _running = false;

// ─── Background task options ──────────────────────────────────────────────────

const taskOptions = {
  taskName: 'fieldreport-upload',
  taskTitle: 'FieldReport — Delivering reports',
  taskDesc: 'Uploading pending reports to server…',
  taskIcon: { name: 'ic_launcher', type: 'mipmap' },
  color: '#2563EB',
  linkingURI: 'fieldreport://outbox',
  // Required on Android 14+ (targetSdk 36): the foreground service type
  // must be passed here AND declared in AndroidManifest.xml. Without it,
  // the OS throws InvalidForegroundServiceTypeException and crashes the app.
  foregroundServiceType: ['dataSync'],
  parameters: { delay: 1000 },
};

// ─── Background task function (runs in foreground service) ──────────────────

async function uploadLoop(): Promise<void> {
  console.log('[BackgroundScheduler] Upload loop started');

  // Lazy require — avoids loading UploadCoordinator + Supabase at module init
  const { UploadCoordinator } = require('./UploadCoordinator') as typeof import('./UploadCoordinator');
  // getState() is safe to call outside React — Zustand stores expose it on the
  // module-level object.  We call refresh() after every job state change so the
  // Outbox screen updates in real-time without polling.
  const { useReportStore } = require('../../store/reportStore') as typeof import('../../store/reportStore');
  const onJobStateChange = () => useReportStore.getState().refresh();

  const coordinator = UploadCoordinator.getInstance({ onJobStateChange });

  try {
    while (_running) {
      const hasWork = await runOneCycle(coordinator);
      if (!hasWork) break;
      await sleep(2000);
    }
  } catch (e) {
    console.error('[BackgroundScheduler] Upload loop error:', e);
  } finally {
    _running = false;
    console.log('[BackgroundScheduler] Upload loop finished');
  }
}

async function runOneCycle(coordinator: import('./UploadCoordinator').UploadCoordinator): Promise<boolean> {
  try {
    await coordinator.processQueue();
    const { getPendingJobs } = require('../../core/database/repositories/UploadJobRepository');
    const pending = getPendingJobs();
    return pending.length > 0;
  } catch (e) {
    console.error('[BackgroundScheduler] Cycle error:', e);
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Starts the background upload service (immediate, app-alive path).
 * Also enqueues a WorkManager job as a backup for when the app is killed.
 * Safe to call multiple times — if already running, this is a no-op.
 */
export async function scheduleUpload(): Promise<void> {
  if (Platform.OS !== 'android') return;

  if (_running) {
    console.log('[BackgroundScheduler] Already running, skipping');
    return;
  }
  _running = true;

  try {
    // Lazy require — BackgroundService is only loaded when needed
    const BackgroundService = require('react-native-background-actions').default;
    await BackgroundService.start(uploadLoop, taskOptions);
  } catch (e) {
    console.warn('[BackgroundScheduler] BackgroundService.start failed:', e);
    _running = false;
  }

  // Also enqueue WorkManager as backup (if app is killed later)
  try {
    const { NativeModules } = require('react-native');
    const { UploadSchedulerModule } = NativeModules;
    if (UploadSchedulerModule) {
      await UploadSchedulerModule.scheduleUpload();
    }
  } catch {
    // Non-fatal
  }
}

/**
 * Stops the background upload service and cancels WorkManager backup.
 */
export async function cancelUpload(): Promise<void> {
  if (Platform.OS !== 'android') return;

  _running = false;

  try {
    const BackgroundService = require('react-native-background-actions').default;
    await BackgroundService.stop();
  } catch {
    // already stopped or not started
  }

  try {
    const { NativeModules } = require('react-native');
    const { UploadSchedulerModule } = NativeModules;
    if (UploadSchedulerModule) {
      await UploadSchedulerModule.cancelUpload();
    }
  } catch {
    // non-fatal
  }
}

/**
 * Returns true if the background upload service is running.
 */
export async function isUploadRunning(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  return _running;
}
