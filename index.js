/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);

/**
 * Headless JS task for WorkManager background uploads.
 * WorkManager wakes this up via UploadWorker → HeadlessUploadTaskService.
 * Must be registered here (in the root index.js) so it is available
 * before any React component mounts.
 */
AppRegistry.registerHeadlessTask(
    'FieldReportUpload',
    () => require('./src/features/uploads/headlessUploadTask').default,
);
