package com.autoskeleton

import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Task 0.4 (tasks.md Phase 0): proves the JUnit + Robolectric harness executes and
 * reports correctly against this module, before any real traversal logic exists.
 * Deleted once 4.1's `AutoskeletonSensorTest.kt` lands with real shared-fixture
 * assertions (plan.md §7.2a).
 */
@RunWith(RobolectricTestRunner::class)
class AutoskeletonHarnessSmokeTest {

    @Test
    fun `robolectric harness executes`() {
        assertEquals(4, 2 + 2)
    }
}
