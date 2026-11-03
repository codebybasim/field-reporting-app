/**
 * headlessUploadTask
 *
 * This is the Headless JS task registered as 'FieldReportUpload'.
 * WorkManager wakes it up via UploadWorker → HeadlessUploadTaskService.
 *
 * Registration in index.js:
 *   AppRegistry.registerHeadlessTask(
 *     'FieldReportUpload',
 *     () => require('./src/features/uploads/headlessUploadTask').default,
 *   );
 *
 * The task:
 *   1. Instantiates the UploadCoordinator with real dependencies
 *   2. Runs all pending uploads
 *   3. Calls notifyTaskComplete() to resume the WorkManager coroutine
 *
 * This file has no React component imports and runs cleanly in a Headless
 * JS context (no UI thread required).
 */
import { notifyTaskComplete } from './BackgroundScheduler';

// The UploadCoordinator is imported lazily so this module can be loaded
// in a headless context before the full JS bundle is ready.
const headlessUploadTask = async (_taskData: unknown): Promise<void> => {
  try {
    // Dynamically require to avoid circular dependencies at module load time
    const { UploadCoordinator } = require('./UploadCoordinator') as typeof import('./UploadCoordinator');
    const coordinator = UploadCoordinator.getInstance();
    await coordinator.processQueue();
    notifyTaskComplete(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[headlessUploadTask] Failed:', message);
    notifyTaskComplete(false, message);
  }
};

export default headlessUploadTask;
