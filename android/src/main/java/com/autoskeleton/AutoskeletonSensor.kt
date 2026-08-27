package com.autoskeleton

import android.content.ComponentCallbacks2
import android.content.res.Configuration
import android.graphics.Rect
import android.view.View
import android.view.ViewGroup
import com.facebook.react.views.image.ReactImageView
import com.facebook.react.views.text.ReactTextView
import com.facebook.react.views.textinput.ReactEditText

// Task 4.1 (tasks.md Phase 4) / plan.md §3.4, §7.2a / brief §4 "Layout sensor": the
// Android `Sensor` implementation. Traverses the real, laid-out `View` tree via
// `offsetDescendantRectToMyCoords` (public `ViewGroup` API — subtracts every
// ancestor's scrollX/scrollY along the way), classifies leaves by RN component-view
// class, applies the container rule, honors `Ignore` via the `nativeID` tag,
// synthesizes collapsed-text line rects (reusing `AutoskeletonLines.kt`, itself a
// port of `src/core/lines.ts`), and exposes `observe()` for the REQ-NAV-1
// invalidation channel (orientation / font-scale).
//
// Radius resolution is deliberately NOT this class's job — ADR-2's degradation
// ladder is `AutoskeletonRadiusResolver` (task 4.2), injected via
// `AutoskeletonSensorOptions.radiusResolver`. This mirrors iOS's structure (one
// sensor, one traversal) while keeping the ladder — the one genuinely Android-
// specific piece of complexity — independently testable and independently
// degradable per plan.md §10 ("removing a rung is a config change, not a
// redesign").
class AutoskeletonSensor(
    private val tracing: AutoskeletonTracing = AutoskeletonSystemTracing(),
) {
    /** COLD PATH. Synchronous. Returns `null` when `root` has zero size (not laid
     *  out yet) — mirrors `Sensor.measure`'s "target is not laid out yet"
     *  contract. */
    fun measure(root: View, options: AutoskeletonSensorOptions = AutoskeletonSensorOptions.defaults): AutoskeletonSensorResult? {
        if (root.width <= 0 || root.height <= 0) {
            return null
        }

        tracing.begin(TRAVERSAL_TRACE_SECTION)
        val startedAtNanos = System.nanoTime()
        val ctx = TraversalContext(options, startedAtNanos)
        val shapes = traverse(root, root, ctx)
        val traversalMs = (System.nanoTime() - startedAtNanos) / 1_000_000.0
        tracing.end(TRAVERSAL_TRACE_SECTION)

        return AutoskeletonSensorResult(shapes, traversalMs, ctx.degraded.toList())
    }

    /** Orientation / font-scale invalidation channel (REQ-NAV-1). RTL is
     *  intentionally not observed here for the same reason as iOS: a live
     *  layout-direction flip mid-session is not a case Android (or iOS) needs to
     *  react to without a full activity/window recreation, which itself already
     *  goes through a fresh `measure()` call — the composite cache key (plan.md
     *  ADR-10) still participates in `direction`, it is just never invalidated
     *  mid-session on either native platform. */
    fun observe(target: View, onInvalidate: (AutoskeletonInvalidationReason) -> Unit): () -> Unit {
        val appContext = target.context.applicationContext
        var lastOrientation = appContext.resources.configuration.orientation
        var lastFontScale = appContext.resources.configuration.fontScale

        val callbacks = object : ComponentCallbacks2 {
            override fun onConfigurationChanged(newConfig: Configuration) {
                if (newConfig.orientation != lastOrientation) {
                    lastOrientation = newConfig.orientation
                    onInvalidate(AutoskeletonInvalidationReason.ORIENTATION)
                }
                if (newConfig.fontScale != lastFontScale) {
                    lastFontScale = newConfig.fontScale
                    onInvalidate(AutoskeletonInvalidationReason.FONT_SCALE)
                }
            }

            override fun onLowMemory() = Unit

            override fun onTrimMemory(level: Int) = Unit
        }
        appContext.registerComponentCallbacks(callbacks)
        return { appContext.unregisterComponentCallbacks(callbacks) }
    }

    // MARK: - Traversal

    private fun traverse(view: View, root: View, ctx: TraversalContext): List<AutoskeletonShapeInfo> {
        if (ctx.truncated) {
            return emptyList()
        }
        val id = nativeId(view)
        if (id != null && ctx.options.hints.isIgnored(id)) {
            return emptyList()
        }
        // A hidden/transparent view contributes no visible pixels, so it must not
        // contribute a skeleton shape either.
        if (view.visibility != View.VISIBLE || view.alpha <= 0.01f) {
            return emptyList()
        }
        if (ctx.overBudget()) {
            return emptyList()
        }

        hardLeafSource(view)?.let { source ->
            return leafShapes(view, root, source, ctx)
        }

        val collected = mutableListOf<AutoskeletonShapeInfo>()
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                if (ctx.truncated) {
                    break
                }
                collected.addAll(traverse(view.getChildAt(i), root, ctx))
            }
        }
        if (collected.isNotEmpty()) {
            return collected
        }

        if (hasNonTransparentBackground(view)) {
            return leafShapes(view, root, AutoskeletonShapeSource.CONTAINER, ctx)
        }

        return emptyList()
    }

    private fun leafShapes(
        view: View,
        root: View,
        source: AutoskeletonShapeSource,
        ctx: TraversalContext,
    ): List<AutoskeletonShapeInfo> {
        val frame = frameOf(view, root)
        if (frame.w <= 0f || frame.h <= 0f) {
            return emptyList()
        }
        val id = nativeId(view)
        val resolution = ctx.options.radiusResolver.resolve(view, ctx.options.hints, id)
        resolution.degraded?.let { ctx.degraded.add(it) }

        if (source == AutoskeletonShapeSource.TEXT && frame.h < ctx.options.defaultLineHeight) {
            val lineCount = id?.let(ctx.options.hints::lines)
            val lines = autoskeletonSynthesizeLines(
                AutoskeletonSynthesizeLinesOptions(
                    x = frame.x,
                    y = frame.y,
                    w = frame.w,
                    h = frame.h,
                    lineHeight = ctx.options.defaultLineHeight,
                    lines = lineCount,
                ),
            )
            if (!ctx.reserveCapacity(lines.size)) {
                return emptyList()
            }
            return lines
        }

        if (!ctx.reserveCapacity(1)) {
            return emptyList()
        }
        return listOf(
            AutoskeletonShapeInfo(
                x = frame.x,
                y = frame.y,
                w = frame.w,
                h = frame.h,
                r = resolution.radius,
                source = source,
                radiusSource = resolution.source,
            ),
        )
    }

    companion object {
        private const val TRAVERSAL_TRACE_SECTION = "AutoskeletonTraversal"

        /** Classifies the three RN leaf-component classes named in brief §4
         *  (`ReactTextView`/`ReactImageView`/`ReactEditText` — confirmed present in
         *  RN 0.87.1). Deliberately NOT recursive past a hard leaf: none of these
         *  three classes are `ViewGroup`s in the first place, so there is nothing
         *  to descend into regardless. */
        fun hardLeafSource(view: View): AutoskeletonShapeSource? = when (view) {
            is ReactTextView -> AutoskeletonShapeSource.TEXT
            is ReactImageView -> AutoskeletonShapeSource.IMAGE
            is ReactEditText -> AutoskeletonShapeSource.INPUT
            else -> null
        }

        /** `true` when the view paints something of its own rather than being a
         *  purely structural, invisible wrapper. Verified empirically (see
         *  `SyntheticHierarchyBuilder`'s class doc): RN's own
         *  `BackgroundStyleApplicator.setBackgroundColor` already collapses
         *  `view.background` to `null` for a fully-transparent color, so a plain
         *  null check is the correct, complete signal — no alpha-channel
         *  inspection needed on top of it. */
        private fun hasNonTransparentBackground(view: View): Boolean = view.background != null

        /** Reads the view's `nativeID` back via the exact public tag
         *  `BaseViewManager.setNativeId` writes (`com.facebook.react.R.id.view_tag_native_id`)
         *  — the public channel plan.md §4 names for both the `Ignore` marker and
         *  typed hints on Android. */
        private fun nativeId(view: View): String? =
            view.getTag(com.facebook.react.R.id.view_tag_native_id) as? String

        private data class Frame(val x: Float, val y: Float, val w: Float, val h: Float)

        /** `offsetDescendantRectToMyCoords` (public `ViewGroup` API) accumulates
         *  every ancestor's scrollX/scrollY between `view` and `root` in one call —
         *  exactly brief §4's "Android: recursion over ViewGroups accumulating
         *  offsets with `offsetDescendantRectToMyCoords` (subtracting scrollX/
         *  scrollY)". */
        private fun frameOf(view: View, root: View): Frame {
            val rect = Rect(0, 0, view.width, view.height)
            if (view !== root && root is ViewGroup) {
                root.offsetDescendantRectToMyCoords(view, rect)
            }
            return Frame(
                x = rect.left.toFloat(),
                y = rect.top.toFloat(),
                w = rect.width().toFloat(),
                h = rect.height().toFloat(),
            )
        }
    }

    /** Reference-type traversal state, mirroring `dom-sensor.ts`'s
     *  `TraversalContext` / iOS's `AutoskeletonTraversalContext`: shared budget/cap
     *  bookkeeping across the whole recursive traversal. */
    private class TraversalContext(val options: AutoskeletonSensorOptions, private val startedAtNanos: Long) {
        var truncated = false
            private set
        private var shapeCount = 0
        val degraded: MutableSet<AutoskeletonDegradationFlag> = linkedSetOf()

        /** Soft budget check (NFR-3 local guard), mirroring `dom-sensor.ts`'s
         *  `overBudget`: called before descending into each node. */
        fun overBudget(): Boolean {
            if (truncated) {
                return true
            }
            val elapsedMs = (System.nanoTime() - startedAtNanos) / 1_000_000.0
            if (elapsedMs > options.budgetMs) {
                truncated = true
                degraded.add(AutoskeletonDegradationFlag.BUDGET_EXCEEDED)
                return true
            }
            return false
        }

        /** Reserves capacity for `count` more shapes against `maxShapes`. Returns
         *  `false` (and truncates the whole traversal) if the cap would be
         *  exceeded. */
        fun reserveCapacity(count: Int): Boolean {
            if (truncated) {
                return false
            }
            if (shapeCount + count > options.maxShapes) {
                truncated = true
                degraded.add(AutoskeletonDegradationFlag.SHAPE_CAP_REACHED)
                return false
            }
            shapeCount += count
            return true
        }
    }
}
