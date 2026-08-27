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
// rect painted with a `LinearGradient` shader created ONCE at mount and translated
// per frame via `Matrix.setTranslate` + `Shader.setLocalMatrix` — rebuilding the
// shader per frame is forbidden (NFR-5). Invalidation is `postInvalidateOnAnimation`
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
     *  rebuild the shader — only the mask path is recomputed. */
    fun update(shapes: List<AutoskeletonShapeInfo>)
    fun setReducedMotion(reducedMotion: Boolean)
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
        reducedMotion: Boolean,
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
        // `ensureShader()` can construct its ONE `LinearGradient` right away rather
        // than silently waiting for a layout pass that might be delayed.
        val widthSpec = View.MeasureSpec.makeMeasureSpec(surface.width, View.MeasureSpec.EXACTLY)
        val heightSpec = View.MeasureSpec.makeMeasureSpec(surface.height, View.MeasureSpec.EXACTLY)
        overlay.measure(widthSpec, heightSpec)
        overlay.layout(0, 0, surface.width, surface.height)
        overlay.updateShapes(shapes)
        overlay.setReducedMotion(reducedMotion)
        tracing.end(MOUNT_TRACE_SECTION)
        return Handle(overlay)
    }

    private class Handle(private val overlay: AutoskeletonShimmerOverlayView) : AutoskeletonRendererHandle {
        override fun update(shapes: List<AutoskeletonShapeInfo>) = overlay.updateShapes(shapes)
        override fun setReducedMotion(reducedMotion: Boolean) = overlay.setReducedMotion(reducedMotion)
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
    private var reducedMotion = false

    /** Test/telemetry seam (NFR-5's direct proof): incremented only when a NEW
     *  `LinearGradient` is constructed — must stay `1` for the view's whole
     *  lifetime once sized. */
    var shaderInstanceCount = 0
        private set

    /** Test seam: the current shader instance, or `null` before the view has ever
     *  been sized/drawn. */
    val currentShader: Shader? get() = shader

    fun updateShapes(shapes: List<AutoskeletonShapeInfo>) {
        maskPath = AutoskeletonRendererTier1.unionPath(shapes)
        postInvalidateOnAnimation()
    }

    fun setReducedMotion(value: Boolean) {
        reducedMotion = value
        if (value) {
            stopAnimating()
        } else {
            startAnimating()
        }
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

    /** Constructs the `LinearGradient` exactly ONCE (NFR-5) — a no-op on every
     *  subsequent call once `shader` is non-null. */
    private fun ensureShader() {
        if (shader != null || width <= 0 || height <= 0) {
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
            val phase = clock.phaseAt(System.currentTimeMillis().toDouble())
            val translateX = ((phase.toFloat() * 2f) - 1f) * width
            matrix.setTranslate(translateX, 0f)
            activeShader.setLocalMatrix(matrix)
            canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
            canvas.restore()
        }
        tracing.end(DRAW_TRACE_SECTION)
    }

    private companion object {
        const val DRAW_TRACE_SECTION = "AutoskeletonDraw"
    }
}
