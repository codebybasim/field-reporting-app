/**
 * ConnectivityDispatcher
 *
 * Listens to network state changes and triggers a WorkManager upload job
 * whenever connectivity is restored.
 *
 * This is intentionally thin — all retry logic lives in UploadCoordinator.
 * The dispatcher's only job is to wake WorkManager when the network comes back.
 *
 * Usage (call once in the app root provider):
 *   ConnectivityDispatcher.start();
 *
 * On reset:
 *   ConnectivityDispatcher.stop();
 */

import { Platform } from 'react-native';
import {
  startMonitoring,
  stopMonitoring,
  addConnectivityListener,
  checkConnectivity,
} from '../../core/network/NetworkMonitor';
import { scheduleUpload } from './BackgroundScheduler';
import { getPendingJobs } from '../../core/database/repositories/UploadJobRepository';

let _removeListener: (() => void) | null = null;
let _started = false;

export function start(): void {
  if (_started) return;
  _started = true;

  startMonitoring();

  _removeListener = addConnectivityListener(async (isConnected) => {
    if (!isConnected) return;
    if (Platform.OS !== 'android') return;

    // Only schedule if there's actually pending work
    const pending = getPendingJobs();
    if (pending.length === 0) return;

    console.log('[ConnectivityDispatcher] Network restored — scheduling upload');
    try {
      await scheduleUpload();
    } catch (e) {
      console.warn('[ConnectivityDispatcher] scheduleUpload failed', e);
    }
  });
}

export function stop(): void {
  _removeListener?.();
  _removeListener = null;
  stopMonitoring();
  _started = false;
}

/**
 * Call once after app boot to immediately attempt upload if online and
 * pending work exists (covers the "app opened with connectivity" case).
 */
export async function triggerIfConnected(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const connected = await checkConnectivity();
  if (!connected) return;
  const pending = getPendingJobs();
  if (pending.length === 0) return;

  console.log('[ConnectivityDispatcher] Online at startup — scheduling upload');
  await scheduleUpload().catch(e =>
    console.warn('[ConnectivityDispatcher] triggerIfConnected scheduleUpload failed', e),
  );
}
