package com.autoskeleton

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
    /** At `maxShapes` = 60 an entry is `1 + 5 * 60` doubles, about 2.4 KB, so
     *  this bounds the cache near 600 KB — room for far more distinct keys
     *  than any one screen produces, and a ceiling instead of a slope.
     *  Deliberately the same value in `AutoskeletonNativeShapeCache.swift`. */
    const val maxEntries = 256

    /** Least-recently-USED, not least-recently-inserted: `accessOrder = true`.
     *  The overlay reads the entry it is painting on every frame, so an
     *  insertion-ordered bound would evict exactly the entry still on screen
     *  whenever a screen keeps measuring new keys.
     *
     *  A `LinkedHashMap` behind a lock rather than the previous
     *  `ConcurrentHashMap`, because access-ordered eviction has no lock-free
     *  form — and `get` MUTATES the order here, so it is not a reader. */
    private val cache = object : LinkedHashMap<String, DoubleArray>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, DoubleArray>): Boolean =
            size > maxEntries
    }

    fun set(cacheKey: String, wire: DoubleArray) {
        synchronized(cache) { cache[cacheKey] = wire }
    }

    fun get(cacheKey: String): DoubleArray? = synchronized(cache) { cache[cacheKey] }

    fun evict(cacheKeys: List<String>) {
        synchronized(cache) {
            for (key in cacheKeys) {
                cache.remove(key)
            }
        }
    }

    /** Test-only full reset; production code never needs to clear the whole
     *  cache (only targeted `evict`). */
    fun clear() {
        synchronized(cache) { cache.clear() }
    }

    val size: Int
        get() = synchronized(cache) { cache.size }
}
