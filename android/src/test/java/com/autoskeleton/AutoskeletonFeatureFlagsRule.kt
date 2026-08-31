package com.autoskeleton

import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests
import org.junit.rules.TestRule
import org.junit.runner.Description
import org.junit.runners.model.Statement

/**
 * Installs React Native's pure-Kotlin feature-flag accessor before each test.
 *
 * WHAT THIS FIXES. Sixteen tests across five classes died with
 *
 *     java.lang.UnsatisfiedLinkError: no react_featureflagsjni in java.library.path
 *     NoClassDefFoundError: Could not initialize class
 *       com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsCxxInterop
 *
 * `ReactNativeFeatureFlags` resolves its values through a C++ interop object by
 * default, and that object needs a `.so` that only exists in an APK. Robolectric
 * runs on the host JVM, where there is no such library and never will be — so
 * any production code path that reads a feature flag takes the whole test class
 * down with a link error, no matter what the test was actually asserting.
 *
 * React Native ships the answer: `ReactNativeFeatureFlagsForTests.setUp()` swaps
 * the accessor for `ReactNativeFeatureFlagsLocalAccessor`, which reads the same
 * defaults in pure Kotlin. Verified present in both 0.77.3 and 0.87.1, so this
 * costs nothing across the supported range.
 *
 * It is a rule rather than a `@Before` in each class so that the reason lives in
 * one place. Applying it to a class that never reads a flag is harmless: it only
 * replaces an accessor.
 */
class AutoskeletonFeatureFlagsRule : TestRule {
  override fun apply(base: Statement, description: Description): Statement =
      object : Statement() {
        override fun evaluate() {
          ReactNativeFeatureFlagsForTests.setUp()
          base.evaluate()
        }
      }
}
