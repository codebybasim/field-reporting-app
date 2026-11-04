/**
 * ResetService
 *
 * Implements the "Reset" feature described in the assessment spec:
 *
 *  1. Cancels WorkManager jobs (no more background wakeups).
 *  2. Stops the ConnectivityDispatcher.
 *  3. Calls UploadCoordinator.reset() to stop in-flight JS queue processing.
 *  4. Deletes all local image files from app-private storage.
 *  5. Deletes all SQLite records (CASCADE removes images + jobs).
 *
 * What is NOT affected:
 *  - Supabase reports and Storage objects are preserved.
 *  - Server-side data is untouched.
 *
 * The reset is irreversible for local pending data. The caller is responsible
 * for showing the confirmation dialog before calling execute().
 */

import { cancelUpload } from './BackgroundScheduler';
import { stop as stopConnectivityDispatcher } from './ConnectivityDispatcher';
// UploadCoordinator is lazy-required below to avoid loading
// @supabase/supabase-js at app launch (crashes Hermes without polyfills).
import {
  deleteAllReports,
} from '../../core/database/repositories/ReportRepository';
import {
  deleteAllJobs,
} from '../../core/database/repositories/UploadJobRepository';
import {
  deleteAllReportFiles,
} from '../../core/filesystem/FileSystemService';
import { Platform } from 'react-native';

export interface ResetResult {
  deletedReports: number;
  filesDeleted: boolean;
  errors: string[];
}

export async function executeReset(pendingCount: number): Promise<ResetResult> {
  const errors: string[] = [];

  // 1. Cancel WorkManager
  if (Platform.OS === 'android') {
    try {
      await cancelUpload();
    } catch (e) {
      errors.push(`WorkManager cancel: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 2. Stop connectivity listener
  try {
    stopConnectivityDispatcher();
  } catch (e) {
    errors.push(`Connectivity stop: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3. Stop JS queue (lazy require to avoid loading Supabase at launch)
  try {
    const { UploadCoordinator } = require('./UploadCoordinator') as typeof import('./UploadCoordinator');
    await UploadCoordinator.getInstance().reset();
    UploadCoordinator.resetInstance();
  } catch (e) {
    errors.push(`Coordinator reset: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 4. Delete image files
  let filesDeleted = false;
  try {
    await deleteAllReportFiles();
    filesDeleted = true;
  } catch (e) {
    errors.push(`File deletion: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 5. Delete SQLite records
  try {
    deleteAllJobs();
    deleteAllReports(); // CASCADE removes images
  } catch (e) {
    errors.push(`Database clear: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { deletedReports: pendingCount, filesDeleted, errors };
}
