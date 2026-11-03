/**
 * BackgroundScheduler
 *
 * JS-side bridge to the Android native UploadSchedulerModule.
 * All scheduling goes through here — never call WorkManager directly from JS.
 *
 * This module has no React dependencies and can be called from anywhere:
 * the UploadCoordinator, connectivity listeners, app startup reconciliation.
 */
import { NativeModules, Platform } from 'react-native';

const { UploadSchedulerModule } = NativeModules;

function assertAndroid(): void {
  if (Platform.OS !== 'android') {
    throw new Error('BackgroundScheduler is Android-only');
  }
}

function assertModule(): void {
  assertAndroid();
  if (!UploadSchedulerModule) {
    throw new Error(
      'UploadSchedulerModule native module not found. ' +
      'Make sure the Android build includes UploadSchedulerPackage.',
    );
  }
}

/**
 * Enqueues a one-time WorkManager upload job.
 * Safe to call multiple times — uses KEEP policy so only one job runs at a time.
 */
export async function scheduleUpload(): Promise<void> {
  assertModule();
  await UploadSchedulerModule.scheduleUpload();
}

/**
 * Cancels any pending / running WorkManager upload job.
 * Called during reset to prevent in-flight workers from processing
 * deleted records.
 */
export async function cancelUpload(): Promise<void> {
  assertModule();
  await UploadSchedulerModule.cancelUpload();
}

/**
 * Returns true if an upload job is currently enqueued or running.
 */
export async function isUploadRunning(): Promise<boolean> {
  assertModule();
  return UploadSchedulerModule.isUploadRunning();
}

/**
 * Called at the end of a Headless JS upload task to signal WorkManager.
 * The native module uses this to resolve the CoroutineWorker continuation.
 *
 * @param success - true if all pending work completed, false to trigger retry
 * @param error   - error message if success is false
 */
export function notifyTaskComplete(success: boolean, error?: string): void {
  if (Platform.OS !== 'android' || !UploadSchedulerModule) return;
  UploadSchedulerModule.notifyTaskComplete(success, error ?? null);
}
