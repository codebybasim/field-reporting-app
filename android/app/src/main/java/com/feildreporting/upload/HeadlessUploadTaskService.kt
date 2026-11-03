package com.feildreporting.upload

import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableNativeMap
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext

/**
 * HeadlessUploadTaskService
 *
 * Bridges WorkManager and React Native's Headless JS mechanism.
 *
 * Uses HeadlessJsTaskContext (the standard RN API) to start a named
 * Headless JS task against the active ReactContext.
 *
 * The task 'FieldReportUpload' must be registered in index.js:
 *   AppRegistry.registerHeadlessTask(
 *     'FieldReportUpload',
 *     () => require('./src/features/uploads/headlessUploadTask').default,
 *   );
 */
object HeadlessUploadTaskService {

    fun createTask(
        reactContext: ReactContext,
        taskName: String,
        timeoutMs: Long,
        onSuccess: () -> Unit,
        onError: (String) -> Unit,
        onTimeout: () -> Unit,
    ): HeadlessTask {
        return HeadlessTask(
            reactContext = reactContext,
            taskName = taskName,
            timeoutMs = timeoutMs,
            onSuccess = onSuccess,
            onError = onError,
            onTimeout = onTimeout,
        )
    }
}

class HeadlessTask(
    private val reactContext: ReactContext,
    private val taskName: String,
    private val timeoutMs: Long,
    private val onSuccess: () -> Unit,
    private val onError: (String) -> Unit,
    private val onTimeout: () -> Unit,
) {
    private val handler = Handler(Looper.getMainLooper())
    @Volatile private var finished = false
    private var taskId: Int = -1

    private val timeoutRunnable = Runnable {
        if (!finished) {
            finished = true
            Log.w("HeadlessTask", "Task '$taskName' timed out")
            onTimeout()
        }
    }

    fun execute() {
        handler.postDelayed(timeoutRunnable, timeoutMs)

        handler.post {
            try {
                val taskData = WritableNativeMap().apply {
                    putString("taskName", taskName)
                    putDouble("timestamp", System.currentTimeMillis().toDouble())
                }

                val config = HeadlessJsTaskConfig(
                    taskName,
                    taskData,
                    timeoutMs,
                    true, // allowedInForeground
                )

                val taskContext = HeadlessJsTaskContext.getInstance(reactContext)
                taskId = taskContext.startTask(config)

                Log.d("HeadlessTask", "Started headless task '$taskName' with id $taskId")

                // Register a listener to detect when the task finishes via AppRegistry
                taskContext.addTaskEventListener(object : com.facebook.react.jstasks.HeadlessJsTaskEventListener {
                    override fun onHeadlessJsTaskStart(id: Int) { /* no-op */ }
                    override fun onHeadlessJsTaskFinish(id: Int) {
                        if (id == taskId) {
                            taskContext.removeTaskEventListener(this)
                            // Task finished naturally via AppRegistry.
                            // The JS side also calls notifyTaskComplete via the native module,
                            // but this guards against cases where that call is missed.
                            finish(success = true)
                        }
                    }
                })

            } catch (e: Exception) {
                Log.e("HeadlessTask", "Failed to start headless task", e)
                finish(success = false, error = e.message ?: "unknown")
            }
        }
    }

    /** Called from JS via UploadSchedulerModule.notifyTaskComplete() to signal completion. */
    fun finish(success: Boolean, error: String? = null) {
        if (finished) return
        finished = true
        handler.removeCallbacks(timeoutRunnable)
        if (success) onSuccess() else onError(error ?: "task failed")
    }

    fun cancel() {
        finished = true
        handler.removeCallbacks(timeoutRunnable)
        if (taskId != -1) {
            try {
                val taskContext = HeadlessJsTaskContext.getInstance(reactContext)
                taskContext.finishTask(taskId)
            } catch (_: Exception) {}
        }
    }
}
