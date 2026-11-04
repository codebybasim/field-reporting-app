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
 *   UploadSchedulerModule.scheduleUpload()  — enqueue WorkManager backup job
 *   UploadSchedulerModule.cancelUpload()     — cancel WorkManager backup job
 *   UploadSchedulerModule.isUploadRunning()  — check WorkManager status
 *
 * Note: The actual upload is run by react-native-background-actions on the
 * JS side.  WorkManager is only a backup for when the app process is killed.
 */
class UploadSchedulerModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "UploadSchedulerModule"
        private const val TAG = "UploadSchedulerModule"
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
}
