package com.autoskeleton

import java.util.concurrent.ConcurrentHashMap

// Task 5.2 (tasks.md Phase 5) / plan.md ADR-9: native-side shape-DATA
// authority, keyed by the same composite cache-key string JS uses.
// Written ONLY when `getShapes()` (task 5.1) runs a real traversal it was
// asked for — never speculatively. Evicted ONLY when JS explicitly
// requests it via `evictShapes` (mirroring `store.invalidate(...)` ->
// native `evict(keys)`), which is what keeps this cache and the JS
// `ShapeStore` from ever diverging (ADR-9's explicit consequence).
//
// The stored value is the FULL wire array `[VERSION, x,y,w,h,r] x N`
// (already density-normalized, dp units) so a future native renderer
// consumer (`AutoskeletonOverlayView`, tasks 3.2/4.4's draw pass) can read
// geometry directly without a second traversal or a second JS round trip.

object AutoskeletonNativeShapeCache {
    private val cache = ConcurrentHashMap<String, DoubleArray>()

    fun set(cacheKey: String, wire: DoubleArray) {
        cache[cacheKey] = wire
    }

    fun get(cacheKey: String): DoubleArray? = cache[cacheKey]

    fun evict(cacheKeys: List<String>) {
        for (key in cacheKeys) {
            cache.remove(key)
        }
    }

    /** Test-only full reset; production code never needs to clear the whole
     *  cache (only targeted `evict`). */
    fun clear() {
        cache.clear()
    }

    val size: Int
        get() = cache.size
}
