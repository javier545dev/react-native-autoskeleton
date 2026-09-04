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
    /** The palette props. Each forwards to a live handle for exactly the
     *  reason `writingDirection` below does: Fabric can deliver a prop after
     *  the mount, and `cacheKey` cannot rescue this one. `composeCacheKey`
     *  (`src/core/cache-key.ts`) identifies GEOMETRY — version, skeleton key,
     *  item type, width bucket, font scale, direction, platform — and carries
     *  no theme segment, deliberately, because geometry does not depend on
     *  colour. So a palette change never invalidates the key and never forces
     *  the remount that would otherwise have applied it.
     *
     *  These were plain fields with no setter body until this was fixed, which
     *  made the user-visible symptom a dark-mode toggle leaving every on-screen
     *  skeleton in the light palette until it happened to unmount. */
    var baseColor: String? = null
        set(value) {
            field = value
            themeDirty = true
        }
    var highlightColor: String? = null
        set(value) {
            field = value
            themeDirty = true
        }
    var defaultRadius: Double = 0.0
        set(value) {
            field = value
            themeDirty = true
        }

    /** DELIBERATELY has no setter body, unlike its three siblings above.
     *
     *  `speedMs` does not belong to this overlay: it is written into
     *  `sharedShimmerClock`, the process-wide clock every mounted overlay
     *  reads its phase from (ADR-8 — one shared origin is what keeps two
     *  skeletons on one screen in phase). Re-applying it post-mount would
     *  change the period for EVERY mounted overlay, and because
     *  `AutoskeletonShimmerClock.phaseAt` divides by `periodMs` against an
     *  unchanged `startedAt`, the phase would jump discontinuously at the
     *  instant of the write — a visible hitch on every skeleton on screen,
     *  caused by one of them mounting.
     *
     *  A speed change therefore takes effect on the next mount, which is the
     *  same guarantee the shared clock already gave. Making a live speed change
     *  correct needs the clock to rebase `startedAt` so the current phase is
     *  preserved across the period change; that is a separate fix with its own
     *  test, not a setter. */
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
        sharedShimmerClock.setPeriod(speedMs)
        handle = renderer.mount(
            this,
            shapes,
            composeTheme(density),
            sharedShimmerClock,
            effectiveAnimation(animation, reducedMotion),
            writingDirection,
        )
        mountedCacheKey = key
    }

    private fun applyMotionState() {
        handle?.setAnimation(effectiveAnimation(animation, reducedMotion))
    }

    /** The current palette, in the units the renderer draws in.
     *
     *  `defaultRadius` arrives from JS as density-independent points (the wire
     *  is dp throughout — see `AutoskeletonModule.encodeWireArray`) and is
     *  scaled to raw view pixels here, the same conversion `mountOrUpdate`
     *  applies to the shapes. One helper so the mount path and the live-update
     *  path can never drift apart on either the defaults or the units. */
    private fun composeTheme(density: Float): AutoskeletonSkeletonTheme = AutoskeletonSkeletonTheme(
        baseColor = parseColorOrDefault(baseColor, Color.LTGRAY),
        highlightColor = parseColorOrDefault(highlightColor, Color.WHITE),
        defaultRadius = defaultRadius.toFloat() * density,
        speedMs = speedMs,
    )

    /** Set by each palette setter, cleared by [flushPendingTheme].
     *
     *  The setters deliberately do NOT push straight to the handle. Fabric
     *  delivers props one at a time, so a single dark-mode toggle arrives as
     *  separate `baseColor` and `highlightColor` calls — and since both colours
     *  are baked into one `LinearGradient`, pushing per setter would discard
     *  and rebuild that gradient once PER PROP rather than once per update.
     *  Coalescing here is also what makes the applied palette always whole: a
     *  push from the first setter would momentarily combine the new base colour
     *  with the OLD highlight. */
    private var themeDirty = false

    /** Applies a coalesced palette change to the live overlay, once per Fabric
     *  update transaction.
     *
     *  Called from `AutoskeletonOverlayViewManager.onAfterUpdateTransaction`,
     *  which React Native invokes after every prop in a batch has been set —
     *  the designated end-of-batch hook, and the only point at which the
     *  incoming props are known to be complete.
     *
     *  A no-op before the first mount: `mountOrUpdate` reads the fields
     *  directly, so there is nothing to forward yet. */
    fun flushPendingTheme() {
        if (!themeDirty) {
            return
        }
        themeDirty = false
        val live = handle ?: return
        val density = resources?.displayMetrics?.density?.takeIf { it > 0f } ?: 1f
        live.setTheme(composeTheme(density))
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

    /** Returns the view to a pristine state so Fabric can hand it to the NEXT
     *  `<AutoSkeleton>` that mounts.
     *
     *  [destroy] is not enough on its own: it clears the MOUNT state (`handle`,
     *  `mountedCacheKey`) and leaves all nine prop fields holding the previous
     *  tenant's values. `BaseViewManager.prepareToRecycleView` resets only base
     *  view state, so without this a recycled overlay could open with the last
     *  screen's palette and animation kind, and — worst of the set — a `cacheKey`
     *  naming geometry measured for a different component entirely.
     *
     *  Every value here is the field's own declared default, which is also the
     *  codegen default Fabric would deliver for an unset prop. `themeDirty` is
     *  cleared last and deliberately: the assignments above go through the
     *  palette setters, which set it, and a pending flush against a handle that
     *  no longer exists is exactly the stale work this reset exists to prevent.
     *
     *  iOS has no equivalent hole — `AutoskeletonOverlayView.mm`'s
     *  `prepareForRecycle` calls `host.destroy()` and Fabric owns the props on
     *  the Objective-C++ view. */
    fun resetForRecycle() {
        destroy()
        cacheKey = null
        baseColor = null
        highlightColor = null
        defaultRadius = 0.0
        speedMs = 1400.0
        animation = ANIMATION_SHIMMER
        reducedMotion = false
        writingDirection = DIRECTION_LTR
        debugOverlay = false
        themeDirty = false
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
