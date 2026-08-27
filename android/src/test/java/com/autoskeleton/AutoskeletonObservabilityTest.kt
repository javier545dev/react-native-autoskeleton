package com.autoskeleton

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Task G.3 (tasks.md, observability gap closure, post-Phase-4) / spec.md
 * REQ-OBS-BUDGET-1/2: pure-function layer tests for `autoskeletonCheckBudgets`/
 * `autoskeletonCheckRadiusFallback` and their formatters — mirrors
 * `metrics.test.ts`'s coverage of `checkBudgets`/`checkRadiusFallback`
 * one-to-one so the two platforms' threshold semantics stay provably identical.
 *
 * This file does NOT prove emission from a real traversal — that is
 * `AutoskeletonSensorObservabilityTest`'s job (the in-context requirement per
 * G.3's brief). This file proves the pure threshold/formatting logic these
 * checks depend on.
 */
@RunWith(RobolectricTestRunner::class)
class AutoskeletonObservabilityTest {

    // MARK: - checkBudgets

    @Test
    fun budgetsWithinBoundsProduceNoWarnings() {
        val result = autoskeletonCheckBudgets(traversalMs = 1.0, shapeCount = 10, budgetMs = 2.0, maxShapes = 60)
        assertFalse(result.budgetExceeded)
        assertFalse(result.shapeCapExceeded)
        assertTrue(result.warnings.isEmpty())
    }

    @Test
    fun timeBudgetExceededProducesActionableWarning() {
        val result = autoskeletonCheckBudgets(traversalMs = 3.4, shapeCount = 10, budgetMs = 2.0, maxShapes = 60)
        assertTrue(result.budgetExceeded)
        assertEquals(1, result.warnings.size)
        assertTrue(result.warnings[0].contains("3.4"))
        assertTrue(result.warnings[0].contains("2.0"))
        assertTrue(result.warnings[0].contains("AutoSkeleton.Ignore"))
    }

    @Test
    fun shapeCapExceededProducesActionableWarning() {
        val result = autoskeletonCheckBudgets(traversalMs = 1.0, shapeCount = 61, budgetMs = 2.0, maxShapes = 60)
        assertTrue(result.shapeCapExceeded)
        assertEquals(1, result.warnings.size)
        assertTrue(result.warnings[0].contains("61"))
        assertTrue(result.warnings[0].contains("60"))
        assertTrue(result.warnings[0].contains("SkeletonProvider"))
    }

    @Test
    fun bothBudgetsExceededProduceTwoWarnings() {
        val result = autoskeletonCheckBudgets(traversalMs = 3.4, shapeCount = 61, budgetMs = 2.0, maxShapes = 60)
        assertEquals(2, result.warnings.size)
    }

    // MARK: - checkRadiusFallback

    @Test
    fun radiusFallbackDefaultThresholdMatchesWebConstant() {
        assertEquals(0.3f, AUTOSKELETON_DEFAULT_RADIUS_FALLBACK_SHARE)
    }

    @Test
    fun radiusFallbackShareExceedingThresholdFires() {
        // 18/20 = 90%, exceeds default 30% threshold — mirrors metrics.test.ts's case.
        val sources = List(18) { AutoskeletonRadiusSource.DEFAULT } +
            List(2) { AutoskeletonRadiusSource.MEASURED }
        val result = autoskeletonCheckRadiusFallback(sources, threshold = AUTOSKELETON_DEFAULT_RADIUS_FALLBACK_SHARE)
        assertTrue(result.shareExceeded)
        assertEquals(18, result.defaultCount)
        assertEquals(20, result.totalCount)
        assertEquals(1, result.warnings.size)
        assertTrue(result.warnings[0].contains("18/20"))
        assertTrue(result.warnings[0].contains("90%"))
        assertTrue(result.warnings[0].contains("30%"))
        assertTrue(result.warnings[0].contains("radius"))
        assertTrue(result.warnings[0].contains("SkeletonProvider.defaultRadius"))
    }

    @Test
    fun radiusFallbackShareExactlyAtThresholdDoesNotFire() {
        // 6/20 = 30% exactly — spec.md REQ-OBS-BUDGET-2 uses `>` not `>=`.
        val sources = List(6) { AutoskeletonRadiusSource.DEFAULT } +
            List(14) { AutoskeletonRadiusSource.MEASURED }
        val result = autoskeletonCheckRadiusFallback(sources, threshold = AUTOSKELETON_DEFAULT_RADIUS_FALLBACK_SHARE)
        assertFalse(result.shareExceeded)
        assertTrue(result.warnings.isEmpty())
    }

    @Test
    fun radiusFallbackWithNoShapesDoesNotFire() {
        val result = autoskeletonCheckRadiusFallback(emptyList(), threshold = AUTOSKELETON_DEFAULT_RADIUS_FALLBACK_SHARE)
        assertFalse(result.shareExceeded)
        assertEquals(0, result.totalCount)
        assertEquals(0f, result.share)
        assertTrue(result.warnings.isEmpty())
    }

    // MARK: - emission seam

    @Test
    fun emitWarningsForwardsEveryWarningToTheEmitter() {
        val emitter = AutoskeletonRecordingWarningEmitter()
        autoskeletonEmitWarnings(listOf("first", "second"), emitter)
        assertEquals(listOf("first", "second"), emitter.warnings)
    }

    @Test
    fun emitWarningsForwardsNothingWhenListIsEmpty() {
        val emitter = AutoskeletonRecordingWarningEmitter()
        autoskeletonEmitWarnings(emptyList(), emitter)
        assertTrue(emitter.warnings.isEmpty())
    }
}
