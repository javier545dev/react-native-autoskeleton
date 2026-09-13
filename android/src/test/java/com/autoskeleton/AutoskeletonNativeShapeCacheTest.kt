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

    // MARK: - Bounded size (unbounded-growth defect)

    /** This cache is a process-lifetime singleton, and its header used to
     *  claim it was "Evicted ONLY when JS explicitly requests it via
     *  `evictShapes` (mirroring `store.invalidate(...)` -> native
     *  `evict(keys)`)". That wiring does not exist: `evictNativeShapes` in
     *  `src/native/wire-bridge.ts` has no call site anywhere in `src/`, and
     *  `store.invalidate()` is never called either. So nothing ever removed
     *  an entry, and every distinct `cacheKey` — a new screen, a new list
     *  item type, a rotation into a different width bucket — added one more
     *  wire array that outlived the view it described, for the life of the
     *  process.
     *
     *  A bound is what makes the word "cache" true. `AutoskeletonNativeShapeCache.swift`
     *  carries the same limit and the same policy. */
    @Test
    fun neverGrowsPastItsBound() {
        AutoskeletonNativeShapeCache.clear()
        repeat(AutoskeletonNativeShapeCache.maxEntries + 50) {
            AutoskeletonNativeShapeCache.set("k$it", doubleArrayOf(it.toDouble()))
        }
        assertEquals(AutoskeletonNativeShapeCache.maxEntries, AutoskeletonNativeShapeCache.size)
        // The oldest went first, the newest is still there.
        assertNull(AutoskeletonNativeShapeCache.get("k0"))
        assertEquals(
            listOf((AutoskeletonNativeShapeCache.maxEntries + 49).toDouble()),
            AutoskeletonNativeShapeCache.get("k${AutoskeletonNativeShapeCache.maxEntries + 49}")!!.toList(),
        )
    }

    /** Least-recently-USED, not merely least-recently-inserted. The entry the
     *  overlay is actively painting from is read on every frame, so a
     *  pure-insertion-order bound would evict exactly the entry still in use
     *  on a screen that keeps measuring new keys. */
    @Test
    fun readingAnEntryProtectsItFromEviction() {
        AutoskeletonNativeShapeCache.clear()
        repeat(AutoskeletonNativeShapeCache.maxEntries) {
            AutoskeletonNativeShapeCache.set("k$it", doubleArrayOf(it.toDouble()))
        }
        AutoskeletonNativeShapeCache.get("k0") // touch the oldest
        AutoskeletonNativeShapeCache.set("overflow", doubleArrayOf(-1.0))

        assertEquals(listOf(0.0), AutoskeletonNativeShapeCache.get("k0")!!.toList())
        assertNull(AutoskeletonNativeShapeCache.get("k1")) // the new oldest went instead
    }

    /** Anti-vacuity: every assertion above would hold for a cache that
     *  evicted on every write. An ordinary working set must survive intact. */
    @Test
    fun anOrdinaryWorkingSetIsNeverEvicted() {
        AutoskeletonNativeShapeCache.clear()
        repeat(10) { AutoskeletonNativeShapeCache.set("k$it", doubleArrayOf(it.toDouble())) }
        assertEquals(10, AutoskeletonNativeShapeCache.size)
        repeat(10) { assertEquals(listOf(it.toDouble()), AutoskeletonNativeShapeCache.get("k$it")!!.toList()) }
    }
}
