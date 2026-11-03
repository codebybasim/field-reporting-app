package com.feildreporting.upload

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * UploadScheduler
 *
 * Enqueues and cancels WorkManager work requests for the upload coordinator.
 *
 * Design decisions:
 *  - Uses KEEP policy: if work is already enqueued / running, a second
 *    enqueue call is a no-op.  This prevents duplicate concurrent uploads.
 *  - Requires CONNECTED network constraint so WorkManager waits for any
 *    network (Wi-Fi or mobile).  The JS coordinator performs its own
 *    connectivity check for fine-grained control.
 *  - Uses one-time work rather than periodic.  The JS side re-enqueues
 *    on connectivity change, giving a faster response than the 15-minute
 *    periodic minimum.
 *  - Retry is handled by Result.retry() in UploadWorker, with WorkManager's
 *    default exponential backoff.
 */
object UploadScheduler {

    private const val TAG = "UploadScheduler"

    fun scheduleUpload(context: Context) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val request = OneTimeWorkRequestBuilder<UploadWorker>()
            .setConstraints(constraints)
            .setInitialDelay(0, TimeUnit.SECONDS)
            .build()

        WorkManager.getInstance(context)
            .enqueueUniqueWork(
                UploadWorker.WORK_NAME,
                ExistingWorkPolicy.KEEP, // never run two uploads concurrently
                request,
            )

        Log.d(TAG, "Upload work enqueued (KEEP policy)")
    }

    fun cancelUpload(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(UploadWorker.WORK_NAME)
        Log.d(TAG, "Upload work cancelled")
    }

    fun isUploadRunning(context: Context): Boolean {
        return try {
            val infos = WorkManager.getInstance(context)
                .getWorkInfosForUniqueWork(UploadWorker.WORK_NAME)
                .get(5, TimeUnit.SECONDS)
            infos.any { it.state == WorkInfo.State.RUNNING || it.state == WorkInfo.State.ENQUEUED }
        } catch (e: Exception) {
            Log.w(TAG, "Could not check work state", e)
            false
        }
    }
}
