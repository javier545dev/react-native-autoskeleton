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

    /** The writing direction the snapshot behind `cacheKey` was measured for,
     *  carried by the `writingDirection` prop — the exact value
     *  `<AutoSkeleton>` composed that key with.
     *
     *  Named `writingDirection` on the wire rather than `direction` because
     *  Fabric already parses a raw prop called `direction` into Yoga's layout
     *  direction, and its accepted values are these very strings; see
     *  `src/native/AutoskeletonOverlayNativeComponent.ts`.
     *
     *  It forwards to a live handle for the same reason `animation` does —
     *  Fabric can deliver a prop after the mount. In practice a direction
     *  change also changes `cacheKey`, so the remount path usually gets there
     *  first; this setter is what makes correctness independent of that. */
    var writingDirection: String = DIRECTION_LTR
        set(value) {
            field = normalizeDirection(value)
            handle?.setDirection(field)
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
        handle = renderer.mount(
            this,
            shapes,
            theme,
            sharedShimmerClock,
            effectiveAnimation(animation, reducedMotion),
            writingDirection,
        )
        mountedCacheKey = key
    }

    private fun applyMotionState() {
        handle?.setAnimation(effectiveAnimation(animation, reducedMotion))
    }

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
        const val ANIMATION_SHIMMER = "shimmer"
        const val ANIMATION_PULSE = "pulse"
        const val ANIMATION_NONE = "none"

        /** Mirrors `Direction` in `src/core/types.ts` — the same two strings
         *  the composite cache key carries in its `direction` segment. */
        const val DIRECTION_LTR = "ltr"
        const val DIRECTION_RTL = "rtl"

        /** Anything that is not exactly `"rtl"` is `"ltr"`.
         *
         *  Same fallback shape, and same reasoning, as `effectiveAnimation`'s
         *  "an unrecognised kind falls back to shimmer": a prop typo must
         *  degrade to the overwhelmingly common case and to the behaviour that
         *  predates the prop, never to the exotic one. `WithDefault<..., 'ltr'>`
         *  in the codegen spec already covers an OMITTED prop; this covers the
         *  value actually being wrong. */
        fun normalizeDirection(direction: String): String =
            if (direction == DIRECTION_RTL) DIRECTION_RTL else DIRECTION_LTR

        /** The Kotlin mirror of `src/core/animation.ts`'s `effectiveAnimation`,
         *  pinned against the same table by `AutoskeletonAnimationKindTest`.
         *  Kotlin cannot import the TypeScript one, so the table is the
         *  contract and both sides are tested against it.
         *
         *  It replaces `isReducedMotionEffective() = reducedMotion || animation
         *  == "none"`, which was wrong in both directions at once: `"pulse"`
         *  was absent from the predicate, so an explicit pulse played the full
         *  travelling shimmer; and `"none"` was present, so the value meaning
         *  "do not animate" was routed into the reduced-motion PULSE.
         *
         *  Reduce-motion only ever REMOVES motion. An unrecognised kind falls
         *  back to `"shimmer"` rather than to `"none"`: a prop typo must not
         *  silently disable a skeleton's animation with no diagnostic. */
        fun effectiveAnimation(animation: String, reducedMotion: Boolean): String {
            val requested = when (animation) {
                ANIMATION_PULSE -> ANIMATION_PULSE
                ANIMATION_NONE -> ANIMATION_NONE
                else -> ANIMATION_SHIMMER
            }
            return if (!reducedMotion || requested == ANIMATION_NONE) requested else ANIMATION_PULSE
        }

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
