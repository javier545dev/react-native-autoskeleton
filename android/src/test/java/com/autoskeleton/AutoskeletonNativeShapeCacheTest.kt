package com.autoskeleton

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** Task 5.2 (tasks.md Phase 5) / plan.md ADR-9: the native shape-data
 *  authority's own get/set/evict semantics, independent of the Turbo
 *  Module glue (`AutoskeletonModuleTest` covers that integration). */
@RunWith(RobolectricTestRunner::class)
class AutoskeletonNativeShapeCacheTest {

    @Test
    fun getReturnsNullForAnUnknownKey() {
        AutoskeletonNativeShapeCache.clear()
        assertNull(AutoskeletonNativeShapeCache.get("missing"))
    }

    @Test
    fun setThenGetRoundTripsTheExactWireArray() {
        AutoskeletonNativeShapeCache.clear()
        val wire = doubleArrayOf(1.0, 10.0, 20.0, 30.0, 40.0, 4.0)
        AutoskeletonNativeShapeCache.set("k", wire)
        assertEquals(wire.toList(), AutoskeletonNativeShapeCache.get("k")!!.toList())
    }

    @Test
    fun evictRemovesOnlyTheRequestedKeysNeverDivergingFromTheJsStoreForOthers() {
        AutoskeletonNativeShapeCache.clear()
        AutoskeletonNativeShapeCache.set("a", doubleArrayOf(1.0))
        AutoskeletonNativeShapeCache.set("b", doubleArrayOf(1.0))
        AutoskeletonNativeShapeCache.set("c", doubleArrayOf(1.0))

        AutoskeletonNativeShapeCache.evict(listOf("a", "c"))

        assertNull(AutoskeletonNativeShapeCache.get("a"))
        assertEquals(1, AutoskeletonNativeShapeCache.size)
        assertNull(AutoskeletonNativeShapeCache.get("c"))
    }

    @Test
    fun evictOfAnUnknownKeyIsANoOp() {
        AutoskeletonNativeShapeCache.clear()
        AutoskeletonNativeShapeCache.set("a", doubleArrayOf(1.0))
        AutoskeletonNativeShapeCache.evict(listOf("does-not-exist"))
        assertEquals(1, AutoskeletonNativeShapeCache.size)
    }

    @Test
    fun setOverwritesAnExistingEntryForTheSameKey() {
        AutoskeletonNativeShapeCache.clear()
        AutoskeletonNativeShapeCache.set("k", doubleArrayOf(1.0, 1.0))
        AutoskeletonNativeShapeCache.set("k", doubleArrayOf(1.0, 2.0))
        assertEquals(listOf(1.0, 2.0), AutoskeletonNativeShapeCache.get("k")!!.toList())
    }
}
