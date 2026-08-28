package com.autoskeleton

import com.facebook.react.bridge.ReactApplicationContext

class AutoskeletonModule(reactContext: ReactApplicationContext) :
  NativeAutoskeletonSpec(reactContext) {

  override fun multiply(a: Double, b: Double): Double {
    return a * b
  }

  companion object {
    const val NAME = NativeAutoskeletonSpec.NAME
  }
}
