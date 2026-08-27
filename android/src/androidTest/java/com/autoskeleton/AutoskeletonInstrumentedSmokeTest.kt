package com.autoskeleton

import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import androidx.test.ext.junit.runners.AndroidJUnit4

/**
 * Task 0.4 (tasks.md Phase 0): proves the instrumented `androidTest` harness runs
 * on a real device/emulator, before any real logic exists. Robolectric shadows
 * `Canvas`/`Bitmap`, so this module is where the R2 raster-probe validation suite
 * (task 4.3, plan.md §7.2b) will actually run — this placeholder is replaced there.
 *
 * Not executed during Phase 0 apply: this module cannot build standalone (it needs
 * a root Gradle project supplying the React Native / Android Gradle Plugin, which
 * only exists once an example app includes it — see task 0.7) and requires a
 * booted emulator or connected device either way.
 */
@RunWith(AndroidJUnit4::class)
class AutoskeletonInstrumentedSmokeTest {

    @Test
    fun instrumentationContextIsAvailable() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assertNotNull(context)
    }
}
