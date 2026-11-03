package com.feildreporting.upload

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceManager
import com.facebook.react.bridge.ReactContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

/**
 * UploadWorker
 *
 * A WorkManager CoroutineWorker that:
 *  1. Wakes up when WorkManager decides to schedule it (network available,
 *     device not Dozing, etc.)
 *  2. Acquires the React instance (or waits for it to initialise if the app
 *     is not yet foreground)
 *  3. Delegates to the Headless JS task registered in index.js under the
 *     name "FieldReportUpload"
 *  4. Waits for the JS task to call its completion callback
 *  5. Returns Result.success() or Result.retry() accordingly
 *
 * Platform limitations (documented honestly):
 *  - After a force-stop Android blocks background work until the user
 *    explicitly relaunches the app.  This is an OS restriction, not a bug.
 *  - WorkManager's minimum periodic interval is 15 minutes on Android.
 *    For the assessment we use a one-time work request re-enqueued on
 *    connectivity change, which gives much faster response in practice.
 *  - WorkManager cannot guarantee immediate execution; it respects Doze,
 *    Battery Saver and OEM-specific restrictions.
 */
class UploadWorker(
    private val appContext: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {

    companion object {
        const val TAG = "UploadWorker"
        /** Unique work name — prevents concurrent duplicate workers */
        const val WORK_NAME = "FieldReportUploadWork"
        /** The Headless JS task name registered in index.js */
        const val JS_TASK_NAME = "FieldReportUpload"
        /** Max time we wait for the JS task to report completion */
        private const val JS_TASK_TIMEOUT_MS = 120_000L
    }

    override suspend fun doWork(): Result {
        Log.d(TAG, "UploadWorker started (attempt ${runAttemptCount + 1})")

        // Enforce an overall cap; WorkManager's own maxAttempts handles the rest.
        if (runAttemptCount >= 5) {
            Log.w(TAG, "Max attempts reached — marking as failure")
            return Result.failure()
        }

        return withContext(Dispatchers.Main) {
            try {
                val success = runJsTask()
                if (success) Result.success() else Result.retry()
            } catch (e: Exception) {
                Log.e(TAG, "UploadWorker failed with exception", e)
                Result.retry()
            }
        }
    }

    /**
     * Acquires a ReactContext and runs the Headless JS task.
     * Returns true if the task reported success, false if it should retry.
     */
    private suspend fun runJsTask(): Boolean {
        val reactContext = getReactContext() ?: run {
            Log.w(TAG, "Could not acquire ReactContext — will retry")
            return false
        }

        return suspendCancellableCoroutine { cont ->
            val task = HeadlessUploadTaskService.createTask(
                reactContext = reactContext,
                taskName = JS_TASK_NAME,
                onSuccess = {
                    Log.d(TAG, "JS task completed successfully")
                    if (cont.isActive) cont.resume(true)
                },
                onError = { error ->
                    Log.e(TAG, "JS task reported error: $error")
                    if (cont.isActive) cont.resume(false)
                },
                onTimeout = {
                    Log.w(TAG, "JS task timed out — will retry")
                    if (cont.isActive) cont.resume(false)
                },
                timeoutMs = JS_TASK_TIMEOUT_MS,
            )
            task.execute()

            cont.invokeOnCancellation {
                task.cancel()
            }
        }
    }

    /**
     * Waits for the ReactInstanceManager to have an active context.
     * If the app process is alive but the React bridge isn't yet ready
     * (e.g. cold start triggered by WorkManager) we wait up to 30 seconds.
     */
    private suspend fun getReactContext(): ReactContext? {
        val app = appContext.applicationContext as? ReactApplication ?: return null
        val host = app.reactHost ?: return null

        // RN 0.74+ uses ReactHost; get context from it
        val existingContext = host.currentReactContext
        if (existingContext != null && existingContext.hasCatalystInstance()) {
            return existingContext
        }

        Log.d(TAG, "ReactContext not ready — waiting for bridge initialisation")

        return withTimeoutOrNull(30_000L) {
            suspendCancellableCoroutine { cont ->
                val latch = CountDownLatch(1)
                var result: ReactContext? = null

                // Poll until ready (bridge init is async on the UI thread)
                val thread = Thread {
                    while (latch.count > 0) {
                        val ctx = host.currentReactContext
                        if (ctx != null && ctx.hasCatalystInstance()) {
                            result = ctx
                            latch.countDown()
                        } else {
                            Thread.sleep(250)
                        }
                    }
                }
                thread.isDaemon = true
                thread.start()

                latch.await(28, TimeUnit.SECONDS)
                if (cont.isActive) cont.resume(result)
                cont.invokeOnCancellation { latch.countDown() }
            }
        }
    }
}
