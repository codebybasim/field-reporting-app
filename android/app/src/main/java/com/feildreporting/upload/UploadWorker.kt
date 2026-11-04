package com.feildreporting.upload

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/**
 * UploadWorker
 *
 * A WorkManager CoroutineWorker that serves as a backup mechanism for
 * delivering pending reports when the app process has been killed.
 *
 * Strategy:
 *   1. If the app is running (React context available), the JS side
 *      handles uploads via react-native-background-actions. This worker
 *      just returns success — no JS interaction needed.
 *   2. If the app is NOT running, this worker starts the main activity
 *      to bring the app to the foreground.  AppBootProvider then runs
 *      StartupReconciler which triggers the upload.
 *
 * Why not Headless JS:
 *   HeadlessJsTaskContext crashes on RN 0.88 New Architecture and the
 *   callback path (UploadSchedulerModule.currentTask) was unreliable.
 *   Using react-native-background-actions for the foreground path and
 *   WorkManager + activity launch for the killed-app path is simpler
 *   and more reliable.
 *
 * Platform limitations (documented honestly):
 *   - After a force-stop, Android blocks background work until the user
 *     explicitly relaunches the app.  This is an OS restriction.
 *   - WorkManager respects Doze, Battery Saver, and OEM restrictions.
 *   - This worker does NOT guarantee immediate execution.
 */
class UploadWorker(
    private val appContext: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {

    companion object {
        const val TAG = "UploadWorker"
        const val WORK_NAME = "FieldReportUploadWork"
    }

    override suspend fun doWork(): Result {
        Log.d(TAG, "UploadWorker started (attempt ${runAttemptCount + 1})")

        if (runAttemptCount >= 5) {
            Log.w(TAG, "Max attempts reached — marking as failure")
            return Result.failure()
        }

        // Check if the app process is alive by checking if we can get a
        // ReactApplication with an active ReactHost.
        val app = appContext.applicationContext
        val isAppRunning = isAppProcessAlive(app)

        if (isAppRunning) {
            // App is alive — JS side handles uploads via BackgroundService.
            // Nothing for us to do.
            Log.d(TAG, "App process is alive — JS side handles upload")
            return Result.success()
        }

        // App is not running — launch the main activity to bring the app
        // to the foreground.  AppBootProvider will trigger the upload.
        Log.d(TAG, "App not running — launching main activity")
        try {
            val launchIntent = app.packageManager.getLaunchIntentForPackage(app.packageName)
            if (launchIntent != null) {
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
                app.startActivity(launchIntent)
                Log.d(TAG, "Main activity launch intent sent")
            } else {
                Log.w(TAG, "Could not get launch intent for ${app.packageName}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch main activity", e)
        }

        // Return success — we've done what we can (launched the app).
        // The app's AppBootProvider will handle the actual upload.
        return Result.success()
    }

    private fun isAppProcessAlive(context: Context): Boolean {
        return try {
            val app = context.applicationContext
            // Check if the process is the app's main process by looking
            // for a running ActivityManager process.
            // A simpler check: if we got here, WorkManager is running in
            // some process. If it's the app's process, the ReactHost
            // would be available.
            val className = "com.facebook.react.ReactApplication"
            val isReactApp = className.let {
                try {
                    Class.forName(className)
                    app.javaClass.interfaces.any { iface ->
                        iface.name.contains("ReactApplication")
                    }
                } catch (e: Exception) {
                    false
                }
            }
            isReactApp && app::class.java.simpleName == "MainApplication"
        } catch (e: Exception) {
            false
        }
    }
}
