package com.autoskeleton

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager

// Visual-paint-gate remediation (tasks.md Phase 5, task 5.7 follow-up):
// registers `AutoskeletonOverlayViewManager` — the piece that was entirely
// ABSENT before this change. `BaseReactPackage` returns an empty view
// manager list unless `createViewManagers` is overridden, so even with a
// correct codegen'd component spec and a correct ViewManager class, Fabric
// would still never receive it without this override.
class AutoskeletonPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
    return if (name == AutoskeletonModule.NAME) {
      AutoskeletonModule(reactContext)
    } else {
      null
    }
  }

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      AutoskeletonModule.NAME to ReactModuleInfo(
        name = AutoskeletonModule.NAME,
        className = AutoskeletonModule.NAME,
        canOverrideExistingModule = false,
        needsEagerInit = false,
        isCxxModule = false,
        isTurboModule = true
      )
    )
  }

  override fun createViewManagers(
    reactContext: ReactApplicationContext,
  ): List<ViewManager<*, *>> = listOf(AutoskeletonOverlayViewManager())
}
