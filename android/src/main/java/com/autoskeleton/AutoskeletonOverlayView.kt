package com.autoskeleton

import android.content.Context
import android.graphics.Color
import android.widget.FrameLayout

// Visual-paint-gate remediation (tasks.md Phase 5, task 5.7 follow-up) /
// plan.md ADR-5, ADR-9: the real native draw surface Fabric mounts for
// "AutoskeletonOverlayView" (the codegen'd component in
// `src/native/AutoskeletonOverlayNativeComponent.ts`). Before this file,
// nothing implemented that component on Android — `requireNativeComponent`
// resolved to a view config Fabric never received, so nothing ever
// painted. This is a thin `FrameLayout` host: it reads shape geometry from
// `AutoskeletonNativeShapeCache` by `cacheKey` (ADR-9 — native holds shape
// DATA, JS holds POLICY; the native `getShapes()` Turbo Module call already
// wrote this cache entry before `cacheKey` is ever set as a prop) and hosts
// the EXISTING, already-tested `AutoskeletonRendererTier1` (task 4.4) —
// this file adds no new drawing logic, only the wiring `AutoskeletonRendererTier1Test`
// already proves correct in isolation.
//
// ADR-8 ("every renderer instance reads the SAME startedAt epoch-ms
// origin... zero cross-instance coordination") requires ONE shared clock,
// created once at module/class-load time — exactly mirroring
// `src/web/AutoSkeleton.tsx`'s `const sharedClock = createShimmerClock();`
// at module scope. A per-mount `AutoskeletonShimmerClock()` (this file's
// original approach) violates that: every remount restarts `startedAt` at
// "now", so the shimmer phase visible at any given wall-clock moment
// becomes purely a function of "how long ago did THIS view happen to
// mount" — never converging with any other instance, and (found while
// chasing `PaintGateInstrumentedTest` flakiness) making the phase at
// first-paint entirely dependent on this session's own JS/native mount
// latency rather than a stable, shared origin.
private val sharedShimmerClock = AutoskeletonShimmerClock()

class AutoskeletonOverlayView(context: Context) : FrameLayout(context) {
    var cacheKey: String? = null
        set(value) {
            field = value
            mountOrUpdate()
        }
    var baseColor: String? = null
    var highlightColor: String? = null
    var defaultRadius: Double = 0.0
    var speedMs: Double = 1400.0
    var animation: String = "shimmer"
        set(value) {
            field = value
            applyMotionState()
        }
    var reducedMotion: Boolean = false
        set(value) {
            field = value
            applyMotionState()
        }
    var debugOverlay: Boolean = false

    private val renderer = AutoskeletonRendererTier1()
    private var handle: AutoskeletonRendererHandle? = null
    private var mountedCacheKey: String? = null

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        mountOrUpdate()
    }

    /** Mounts on first opportunity (sized + a cache hit for `cacheKey`),
     *  updates shapes in place when the SAME `cacheKey` is re-set with
     *  fresher data (e.g. an ADR-2 R2 raster-probe `refine()` landing a
     *  second, more accurate snapshot) — critically, `update()` never
     *  restarts the shimmer phase (mirrors `AutoskeletonRendererTier1Test`'s
     *  own contract) — and remounts only when the key genuinely changes. A
     *  cache miss is a safe no-op: no shapes were ever traversed for this
     *  key (or they were evicted), so there is nothing to draw yet. */
    private fun mountOrUpdate() {
        val key = cacheKey
        if (key == null || width <= 0 || height <= 0) {
            return
        }
        val wire = AutoskeletonNativeShapeCache.get(key) ?: return
        // `AutoskeletonModule.encodeWireArray` divides every geometry value
        // by `resources.displayMetrics.density` before caching (plan.md
        // §4.1 "Units": the wire is density-independent points, comparable
        // across platforms). `AutoskeletonRendererTier1`'s draw pass —
        // proven correct in isolation by `AutoskeletonRendererTier1Test` —
        // instead expects RAW VIEW PIXELS, matching this `View`'s own
        // `width`/`height` (also raw pixels) and its `Canvas`'s coordinate
        // space. Multiplying back by density here is what makes the two
        // sides of that same wire agree: confirmed empirically via
        // `PaintGateInstrumentedTest` plus targeted logging — without this,
        // every shape drew roughly `1/density` too small and offset, so the
        // sampled pixel (the true content's own center) never fell inside
        // the drawn (mis-scaled) skeleton region at all.
        val density = resources?.displayMetrics?.density?.takeIf { it > 0f } ?: 1f
        val shapes = decodeWireShapes(wire, density)

        val existingHandle = handle
        if (existingHandle != null && mountedCacheKey == key) {
            existingHandle.update(shapes)
            return
        }

        existingHandle?.destroy()
        val theme = AutoskeletonSkeletonTheme(
            baseColor = parseColorOrDefault(baseColor, Color.LTGRAY),
            highlightColor = parseColorOrDefault(highlightColor, Color.WHITE),
            defaultRadius = defaultRadius.toFloat() * density,
            speedMs = speedMs,
        )
        sharedShimmerClock.setPeriod(speedMs)
        handle = renderer.mount(this, shapes, theme, sharedShimmerClock, isReducedMotionEffective())
        mountedCacheKey = key
    }

    private fun applyMotionState() {
        handle?.setReducedMotion(isReducedMotionEffective())
    }

    /** Tier-1's `AutoskeletonRendererHandle` only exposes a binary
     *  reduced-motion toggle (pulse vs. shimmer — task 4.4's existing
     *  contract). `animation == "none"` has no dedicated tier-1 visual, so
     *  it degrades to the same static/pulse path as reduced motion rather
     *  than an unhandled case. */
    private fun isReducedMotionEffective(): Boolean = reducedMotion || animation == "none"

    /** Removes the mounted overlay, if any. Called from
     *  `AutoskeletonOverlayViewManager.onDropViewInstance` — Fabric view
     *  recycling/unmount must not leak the tier-1 draw pass's Choreographer
     *  callback. */
    fun destroy() {
        handle?.destroy()
        handle = null
        mountedCacheKey = null
    }

    companion object {
        /** Pure: `[VERSION, x,y,w,h,r] x N` (density-independent points) ->
         *  raw-pixel shape rectangles, scaling every geometry component by
         *  `density` (plan.md §4.1). `source`/`radiusSource` never travel
         *  on the wire (dev-only sidecars, a separate channel) and are
         *  irrelevant to `AutoskeletonRendererTier1.unionPath`, which only
         *  reads `x/y/w/h/r` — CONTAINER/DEFAULT are honest placeholders,
         *  not guesses about provenance this decoder cannot know. */
        internal fun decodeWireShapes(wire: DoubleArray, density: Float): List<AutoskeletonShapeInfo> {
            if (wire.isEmpty()) {
                return emptyList()
            }
            val shapeCount = (wire.size - 1) / 5
            val shapes = ArrayList<AutoskeletonShapeInfo>(shapeCount)
            for (i in 0 until shapeCount) {
                val offset = 1 + i * 5
                shapes.add(
                    AutoskeletonShapeInfo(
                        x = wire[offset].toFloat() * density,
                        y = wire[offset + 1].toFloat() * density,
                        w = wire[offset + 2].toFloat() * density,
                        h = wire[offset + 3].toFloat() * density,
                        r = wire[offset + 4].toFloat() * density,
                        source = AutoskeletonShapeSource.CONTAINER,
                        radiusSource = AutoskeletonRadiusSource.DEFAULT,
                    ),
                )
            }
            return shapes
        }

        private fun parseColorOrDefault(hex: String?, default: Int): Int =
            try {
                if (hex != null) Color.parseColor(hex) else default
            } catch (e: IllegalArgumentException) {
                default
            }
    }
}
