package com.autoskeleton

import android.content.Context
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.LinearGradient
import android.view.View
import android.view.ViewGroup
import kotlin.math.min

// Task 4.4 (tasks.md Phase 4) / plan.md §3.5, §7.2c, brief §4 "Renderers > Default":
// the Android tier-1 (zero-dependency) `Renderer` implementation. A SINGLE draw
// pass: a `Path` union of every shape's rounded rect, `canvas.clipPath`, and one
// rect painted with a `LinearGradient` shader created once PER OVERLAY WIDTH and
// translated per frame via `Matrix.setTranslate` + `Shader.setLocalMatrix` —
// rebuilding the shader per frame is forbidden (NFR-5). Invalidation is `postInvalidateOnAnimation`
// driven by `Choreographer` (via the injectable `AutoskeletonFrameScheduler` seam),
// which is a purely native Android mechanism with zero JS involvement — this is
// what makes NFR-2 (shimmer survives a blocked JS thread) true by construction on
// this platform, mirroring how iOS's CoreAnimation-driven shimmer does the same.

data class AutoskeletonSkeletonTheme(
    val baseColor: Int,
    val highlightColor: Int,
    val defaultRadius: Float,
    val speedMs: Double,
)

interface AutoskeletonRendererHandle {
    /** Geometry-only update. MUST NOT restart the shimmer phase and MUST NOT
     *  rebuild the shader — only the mask path is recomputed. (A shader
     *  rebuild is driven exclusively by an actual OVERLAY width change, via
     *  `onSizeChanged`; a shape update never changes the overlay's size.) */
    fun update(shapes: List<AutoskeletonShapeInfo>)

    /** The RESOLVED presentation — one of `"shimmer"`, `"pulse"`, `"none"`,
     *  already reconciled with the platform preference by
     *  `AutoskeletonOverlayView.effectiveAnimation` (the Kotlin mirror of
     *  `src/core/animation.ts`).
     *
     *  This replaced `setReducedMotion(Boolean)`. A boolean cannot carry three
     *  kinds, and collapsing them is what produced two opposite defects at
     *  once: `"pulse"` fell through to the travelling shimmer because it was
     *  not "reduced", and `"none"` was routed INTO the reduced-motion pulse —
     *  an animation, for the value that means "do not animate". */
    fun setAnimation(animation: String)

    /** The writing direction the shapes were measured for — `"ltr"` or
     *  `"rtl"`, forwarded from the SAME value `<AutoSkeleton>` put into the
     *  composite shape cache key (`src/core/cache-key.ts`), never re-read from
     *  `View.getLayoutDirection()` here. The key already stores a separate
     *  snapshot per direction; a view that asked Android instead could answer
     *  differently from the key it is painting (an `android:layoutDirection`
     *  on an ancestor moves one and not the other), and the failure mode of
     *  that disagreement is a snapshot captured for one direction swept with
     *  the other's highlight. */
    fun setDirection(direction: String)
    fun destroy()
}

class AutoskeletonRendererTier1(
    private val tracing: AutoskeletonTracing = AutoskeletonSystemTracing(),
) {
    val kind = "native"
    val supportsRadius = true

    fun isAvailable(): Boolean = true

    fun mount(
        surface: ViewGroup,
        shapes: List<AutoskeletonShapeInfo>,
        theme: AutoskeletonSkeletonTheme,
        clock: AutoskeletonShimmerClock,
        animation: String,
        // Defaulted so every existing caller — including
        // `AutoskeletonRendererTier1Test`, which passes `animation` and
        // `scheduler` by name — keeps compiling AND keeps sweeping
        // left-to-right, which is the only direction this renderer had before.
        direction: String = AutoskeletonOverlayView.DIRECTION_LTR,
        scheduler: AutoskeletonFrameScheduler = AutoskeletonChoreographerFrameScheduler(),
    ): AutoskeletonRendererHandle {
        val token = tracing.begin(MOUNT_TRACE_SECTION)
        val overlay = AutoskeletonShimmerOverlayView(surface.context, theme, clock, scheduler, tracing)
        surface.addView(
            overlay,
            ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
        // `addView` alone does not guarantee a measure/layout pass runs before the
        // next frame (that depends on the host window's own layout cycle, which may
        // not have happened yet) — size the overlay to the surface immediately so
        // `ensureShader()` can construct its first `LinearGradient` right away rather
        // than silently waiting for a layout pass that might be delayed.
        val widthSpec = View.MeasureSpec.makeMeasureSpec(surface.width, View.MeasureSpec.EXACTLY)
        val heightSpec = View.MeasureSpec.makeMeasureSpec(surface.height, View.MeasureSpec.EXACTLY)
        overlay.measure(widthSpec, heightSpec)
        overlay.layout(0, 0, surface.width, surface.height)
        overlay.updateShapes(shapes)
        overlay.setDirection(direction)
        overlay.setAnimation(animation)
        tracing.end(MOUNT_TRACE_SECTION)
        return Handle(overlay)
    }

    private class Handle(private val overlay: AutoskeletonShimmerOverlayView) : AutoskeletonRendererHandle {
        override fun update(shapes: List<AutoskeletonShapeInfo>) = overlay.updateShapes(shapes)
        override fun setAnimation(animation: String) = overlay.setAnimation(animation)
        override fun setDirection(direction: String) = overlay.setDirection(direction)
        override fun destroy() = overlay.destroySelf()
    }

    companion object {
        private const val MOUNT_TRACE_SECTION = "AutoskeletonRendererMount"

        /** Combines every shape's rounded rect into one union `Path`, radius
         *  clamped to half the shorter side — pure and independently testable. */
        fun unionPath(shapes: List<AutoskeletonShapeInfo>): Path {
            val path = Path()
            for (shape in shapes) {
                val rect = RectF(shape.x, shape.y, shape.x + shape.w, shape.y + shape.h)
                val radius = min(shape.r, min(shape.w, shape.h) / 2f)
                if (radius > 0f) {
                    path.addRoundRect(rect, radius, radius, Path.Direction.CW)
                } else {
                    path.addRect(rect, Path.Direction.CW)
                }
            }
            return path
        }
    }
}

/** The mounted overlay view. Package-visible (not `private`) so tests can assert
 *  directly on shader identity / draw-pass invariants — the same rationale
 *  `AutoskeletonRecordingTracing` and friends use elsewhere in this module. */
class AutoskeletonShimmerOverlayView internal constructor(
    context: Context,
    private val theme: AutoskeletonSkeletonTheme,
    private val clock: AutoskeletonShimmerClock,
    private val scheduler: AutoskeletonFrameScheduler,
    private val tracing: AutoskeletonTracing,
) : View(context) {
    private var maskPath = Path()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val matrix = Matrix()
    private var shader: LinearGradient? = null
    private var animating = false
    private var animation = AutoskeletonOverlayView.ANIMATION_SHIMMER
    private var direction = AutoskeletonOverlayView.DIRECTION_LTR

    /** The opaque base fill drawn UNDER the highlight for every kind whose
     *  highlight is not itself fully covering. Allocated once, never per frame
     *  (NFR-5), and never `paint` itself — `paint` carries the gradient shader
     *  and has its alpha modulated by the pulse. */
    private val basePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = theme.baseColor }

    /** Test/telemetry seam (NFR-5's direct proof): incremented only when a NEW
     *  `LinearGradient` is constructed — must stay constant across any number
     *  of frames and geometry updates, and may only move when the overlay's
     *  own WIDTH changes. */
    var shaderInstanceCount = 0
        private set

    /** The `width` the current `shader` was built for. The gradient's stops
     *  span `-width .. +width`, so this is the shader's complete geometry key
     *  — `0` means "no shader yet", which `width > 0` already excludes. */
    private var shaderWidth = 0

    /** Test seam: the current shader instance, or `null` before the view has ever
     *  been sized/drawn. */
    val currentShader: Shader? get() = shader

    /** Test seams for the draw pass. A `Canvas` in a Robolectric unit test
     *  rasterizes nothing inspectable, so the three values that actually decide
     *  what a frame looks like are recorded as they are applied. They are read
     *  by `AutoskeletonAnimationKindTest`, which is the only gate that can tell
     *  a parked gradient apart from a frozen one. */
    var lastShaderTranslateX = 0f
        private set

    /** `0` when no highlight was drawn at all, `255` when it was drawn opaque. */
    var lastHighlightAlpha = 0
        private set

    /** Whether the last frame laid down the opaque base fill before the
     *  highlight. Required for every non-shimmer kind: without it the pulse's
     *  trough would make the skeleton see-through and the real content would
     *  read through the loading state. */
    var lastDrewOpaqueBase = false
        private set

    fun updateShapes(shapes: List<AutoskeletonShapeInfo>) {
        maskPath = AutoskeletonRendererTier1.unionPath(shapes)
        postInvalidateOnAnimation()
    }

    /** `animation` is the already-resolved kind (see
     *  `AutoskeletonRendererHandle.setAnimation`).
     *
     *  Only `"none"` stops the frame loop. `"pulse"` is an ANIMATION and has to
     *  be driven, exactly as the CSS renderer drives `@keyframes askl-pulse`
     *  and iOS drives its `CABasicAnimation`; stopping the loop for it was the
     *  Android half of the defect, and it left the gradient frozen at whatever
     *  phase the last drawn frame happened to reach — a streak parked at an
     *  arbitrary point across the skeleton, its position determined by WHEN the
     *  user toggled the setting. `onDraw` now parks it deliberately instead.
     *
     *  The trailing invalidate is what makes the static kind actually repaint:
     *  with the loop stopped, nothing else would ever ask for the frame that
     *  shows the new state. */
    fun setAnimation(value: String) {
        animation = value
        if (value == AutoskeletonOverlayView.ANIMATION_NONE) {
            stopAnimating()
        } else {
            startAnimating()
        }
        postInvalidateOnAnimation()
    }

    /** Sets the sweep's travel direction. No frame-loop change and no shader
     *  rebuild: the shader's stops span `-width .. +width` and its colours are
     *  symmetric about its centre, so direction only ever affects the
     *  per-frame `Matrix.setTranslate` in [onDraw]. The trailing invalidate is
     *  what repaints under `"none"`/`"pulse"`, where nothing else would ask
     *  for a frame — the same reason [setAnimation] ends with one. */
    fun setDirection(value: String) {
        direction = if (value == AutoskeletonOverlayView.DIRECTION_RTL) {
            AutoskeletonOverlayView.DIRECTION_RTL
        } else {
            AutoskeletonOverlayView.DIRECTION_LTR
        }
        postInvalidateOnAnimation()
    }

    fun destroySelf() {
        stopAnimating()
        (parent as? ViewGroup)?.removeView(this)
    }

    private fun startAnimating() {
        if (animating) return
        animating = true
        scheduleNextFrame()
    }

    private fun stopAnimating() {
        animating = false
        scheduler.cancel()
    }

    private fun scheduleNextFrame() {
        if (!animating) return
        scheduler.postFrameCallback {
            postInvalidateOnAnimation()
            scheduleNextFrame()
        }
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        ensureShader()
    }

    /** Constructs the `LinearGradient` once per distinct overlay WIDTH — a
     *  no-op on every call whose geometry the current shader already matches,
     *  which is every call from `onDraw` (NFR-5: zero per-frame allocations).
     *
     *  Adversarial-review defect (2026-08-29): this used to short-circuit on
     *  `shader != null` alone, so `onSizeChanged` — the only caller that can
     *  ever observe a geometry change — could never rebuild anything. NFR-5
     *  says do not rebuild PER FRAME; that had been implemented as NEVER, a
     *  strictly different invariant. The gradient's stops are a pure function
     *  of `width` (`-width .. +width`), so a resized view kept a band built
     *  for the old span for the rest of its life. `shaderWidth` is the
     *  geometry key that separates the two: a frame never changes it, a real
     *  resize does. HEIGHT deliberately does not participate — it appears
     *  nowhere in the gradient — so a list growing vertically still allocates
     *  nothing. */
    private fun ensureShader() {
        if (width <= 0 || height <= 0 || (shader != null && shaderWidth == width)) {
            return
        }
        val gradient = LinearGradient(
            -width.toFloat(),
            0f,
            width.toFloat(),
            0f,
            intArrayOf(theme.baseColor, theme.highlightColor, theme.baseColor),
            floatArrayOf(0f, 0.5f, 1f),
            Shader.TileMode.CLAMP,
        )
        shader = gradient
        paint.shader = gradient
        shaderWidth = width
        shaderInstanceCount += 1
    }

    /** The entire draw pass. NEVER mutates view state (visibility/alpha) here —
     *  hide/restore happens only on the `isLoading` transition, wired by the
     *  future public `<AutoSkeleton>` component (Phase 5), never from inside this
     *  method. */
    override fun onDraw(canvas: Canvas) {
        val token = tracing.begin(DRAW_TRACE_SECTION)
        ensureShader()
        val activeShader = shader
        if (activeShader != null && width > 0 && height > 0) {
            canvas.save()
            canvas.clipPath(maskPath)

            val w = width.toFloat()
            val h = height.toFloat()
            val isNone = animation == AutoskeletonOverlayView.ANIMATION_NONE
            val isPulse = animation == AutoskeletonOverlayView.ANIMATION_PULSE

            // Every kind except the travelling shimmer needs its own opaque
            // base: the shimmer's gradient clamps to the base colour beyond the
            // band and is therefore already fully covering, while the pulse's
            // is translucent for most of its cycle and 'none' draws no
            // highlight at all. "Do not animate" must never become "do not
            // paint" — the skeleton still has to hide the content beneath it.
            lastDrewOpaqueBase = isNone || isPulse
            if (lastDrewOpaqueBase) {
                canvas.drawRect(0f, 0f, w, h, basePaint)
            }

            if (isNone) {
                lastHighlightAlpha = 0
            } else {
                val phase = clock.phaseAt(System.currentTimeMillis().toDouble())
                // `((phase * 2) - 1) * w` sweeps `-w -> +w` across one
                // period; RTL traverses the SAME span the other way, which is
                // that expression negated. Nothing else about the frame
                // changes: the `LinearGradient`'s stops are
                // `[base, highlight, base]` at `[0, 0.5, 1]`, symmetric about
                // its own centre, so reversing the translation is the whole
                // flip and `ensureShader` still allocates nothing (NFR-5).
                //
                // PHASE IS UNTOUCHED — `phase` still comes from the shared
                // `AutoskeletonShimmerClock` (ADR-8), so direction changes
                // WHERE the band is at a given phase, never WHEN the phase is,
                // and every instance on screen stays on one wave. iOS reverses
                // `applyShimmer`'s from/to for the same reason and tier-2's
                // `travelAt` negates the same term, because a sweep that flips
                // on two of the three renderers is worse than one that never
                // flips at all.
                val ltrSweepTranslateX = ((phase.toFloat() * 2f) - 1f) * w
                val sweepTranslateX =
                    if (direction == AutoskeletonOverlayView.DIRECTION_RTL) -ltrSweepTranslateX else ltrSweepTranslateX
                // The pulse parks the band at the container's CENTRE — the
                // named resting position `core/animation.ts` defines and every
                // renderer shares — instead of leaving it wherever the sweep
                // last happened to be. That park carries NO direction term on
                // purpose: a band whose colours are symmetric about its centre,
                // parked at the container's centre, is the same picture
                // mirrored. iOS translates by `width / 2` with no direction
                // term either, and tier-2 mirrors its park DRIVE precisely so
                // that it lands on this same point.
                lastShaderTranslateX = if (isPulse) w / 2f else sweepTranslateX
                lastHighlightAlpha = if (isPulse) pulseAlpha(phase) else 255
                matrix.setTranslate(lastShaderTranslateX, 0f)
                activeShader.setLocalMatrix(matrix)
                paint.alpha = lastHighlightAlpha
                canvas.drawRect(0f, 0f, w, h, paint)
            }
            canvas.restore()
        }
        tracing.end(DRAW_TRACE_SECTION)
    }

    companion object {
        private const val DRAW_TRACE_SECTION = "AutoskeletonDraw"

        /** The pulse's trough, as an 8-bit alpha. Mirrors
         *  `PULSE_MIN_OPACITY` (0.6) in `src/core/animation.ts`. */
        const val PULSE_MIN_ALPHA = 153

        /** A raised cosine over the SHARED clock's phase: `PULSE_MIN_ALPHA` at
         *  phase 0, opaque at phase 0.5, back to the floor at phase 1 — one
         *  full breath per clock period, matching the web `@keyframes
         *  askl-pulse` rule and iOS's auto-reversing `CABasicAnimation`.
         *
         *  Deriving it from `clock.phaseAt` rather than running a separate
         *  animator is what keeps every instance on this screen breathing
         *  together (ADR-8) for free — this renderer already draws every frame
         *  itself, so there is nothing extra to schedule. */
        fun pulseAlpha(phase: Double): Int {
            val breath = (1.0 - kotlin.math.cos(2.0 * Math.PI * phase)) / 2.0
            return (PULSE_MIN_ALPHA + (255 - PULSE_MIN_ALPHA) * breath).toInt().coerceIn(PULSE_MIN_ALPHA, 255)
        }
    }
}
