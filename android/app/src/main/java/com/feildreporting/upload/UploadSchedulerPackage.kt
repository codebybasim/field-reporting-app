package com.feildreporting.upload

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * UploadSchedulerPackage
 *
 * Registers UploadSchedulerModule so React Native's PackageList / autolinking
 * can find it.  Manually added in MainApplication because we own this module
 * (it's not a third-party package and has no package.json for autolinking).
 */
class UploadSchedulerPackage : ReactPackage {

    override fun createNativeModules(
        reactContext: ReactApplicationContext,
    ): List<NativeModule> = listOf(UploadSchedulerModule(reactContext))

    override fun createViewManagers(
        reactContext: ReactApplicationContext,
    ): List<ViewManager<*, *>> = emptyList()
}
