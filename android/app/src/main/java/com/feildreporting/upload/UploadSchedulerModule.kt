package com.feildreporting.upload

import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * UploadSchedulerModule
 *
 * React Native Native Module that exposes WorkManager scheduling to JS.
 *
 * JS usage (via BackgroundScheduler.ts):
 *   import { NativeModules } from 'react-native'
 *   const { UploadSchedulerModule } = NativeModules
 *   UploadSchedulerModule.scheduleUpload()
 *   UploadSchedulerModule.cancelUpload()
 *   UploadSchedulerModule.notifyTaskComplete(success, error)
 */
class UploadSchedulerModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "UploadSchedulerModule"
        private const val TAG = "UploadSchedulerModule"

        /**
         * Singleton reference to the currently-running HeadlessTask.
         * Set by UploadWorker before executing; cleared on finish/cancel.
         * Allows JS to signal completion back to the worker.
         */
        @Volatile
        var currentTask: HeadlessTask? = null
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun scheduleUpload(promise: Promise) {
        try {
            UploadScheduler.scheduleUpload(reactContext)
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "scheduleUpload failed", e)
            promise.reject("SCHEDULE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun cancelUpload(promise: Promise) {
        try {
            UploadScheduler.cancelUpload(reactContext)
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "cancelUpload failed", e)
            promise.reject("CANCEL_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun isUploadRunning(promise: Promise) {
        try {
            val running = UploadScheduler.isUploadRunning(reactContext)
            promise.resolve(running)
        } catch (e: Exception) {
            Log.e(TAG, "isUploadRunning failed", e)
            promise.reject("STATUS_ERROR", e.message, e)
        }
    }

    /**
     * Called from the JS Headless task when it finishes (success or failure).
     * This signals the UploadWorker coroutine to resume and return the result.
     */
    @ReactMethod
    fun notifyTaskComplete(success: Boolean, error: String?) {
        Log.d(TAG, "notifyTaskComplete called: success=$success error=$error")
        currentTask?.finish(success = success, error = error)
        currentTask = null
    }
}
