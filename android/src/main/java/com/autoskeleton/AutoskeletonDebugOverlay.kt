package com.autoskeleton

import android.content.Context
import android.content.pm.ApplicationInfo
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.View
import android.view.ViewGroup
import kotlin.math.min

// Task 4.5 (tasks.md Phase 4) / spec.md REQ-OBS-OVERLAY-1, plan.md ADR-2: the
// Android `debugOverlay` — outlines every detected shape with its index, source
// type, cache hit/miss badge, AND (ADR-2's mandatory addition on this platform) its
// radius-resolution rung, so a developer can see Android's radius degradation
// directly instead of guessing at it (plan.md: "the debug overlay badges each shape
// with its rung").

class AutoskeletonDebugOverlay internal constructor(context: Context) : View(context) {
    data class Badge(
        val index: Int,
        val source: AutoskeletonShapeSource,
        val cacheHit: Boolean,
        val radiusSource: AutoskeletonRadiusSource,
    )

    private var shapes: List<AutoskeletonShapeInfo> = emptyList()
    private var cacheHit: Boolean = false

    private val outlinePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 2f
        color = Color.RED
    }
    private val badgePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.RED
        textSize = 24f
    }

    /** Test/telemetry seam: the badges from the most recent [update] call —
     *  REPLACED (never appended to) on every call, so re-mounting on a data update
     *  never leaves a stale badge behind (mirrors iOS's `mount()` "clears any
     *  previously mounted overlay first"). */
    var lastBadges: List<Badge> = emptyList()
        private set

    /** REQ-OBS-OVERLAY-1: one outline + one badge (index, source, cache hit/miss,
     *  AND ADR-2's radius rung) per shape. */
    fun update(shapes: List<AutoskeletonShapeInfo>, cacheHit: Boolean) {
        this.shapes = shapes
        this.cacheHit = cacheHit
        lastBadges = shapes.mapIndexed { index, shape ->
            Badge(index = index, source = shape.source, cacheHit = cacheHit, radiusSource = shape.radiusSource)
        }
        invalidate()
    }

    fun clear() {
        shapes = emptyList()
        lastBadges = emptyList()
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        for ((index, shape) in shapes.withIndex()) {
            val radius = min(shape.r, min(shape.w, shape.h) / 2f).coerceAtLeast(0f)
            val rect = RectF(shape.x, shape.y, shape.x + shape.w, shape.y + shape.h)
            canvas.drawRoundRect(rect, radius, radius, outlinePaint)

            val hitMiss = if (cacheHit) "HIT" else "MISS"
            val badgeText = "$index ${shape.source.wireValue} $hitMiss ${shape.radiusSource.wireValue}"
            canvas.drawText(badgeText, shape.x, (shape.y - 4f).coerceAtLeast(badgePaint.textSize), badgePaint)
        }
    }
}

/** Dev-only mount gate. **Stated deviation from iOS's `#if DEBUG` compile-time
 *  strip**: a published Android AAR is a single already-compiled variant, so a
 *  Swift-style build-time strip is not available to a library the way it is to a
 *  CocoaPods pod compiled from source into the app. The standard, portable
 *  mechanism for a library to gate dev-only behavior on the CONSUMING app's own
 *  debug/release build is the runtime `ApplicationInfo.FLAG_DEBUGGABLE` check
 *  below — the same technique Android's own tooling (e.g. `StrictMode`) uses for
 *  the same purpose. */
object AutoskeletonDebugOverlayFactory {
    fun isDebugBuild(context: Context): Boolean =
        (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

    /** Mounts a fresh [AutoskeletonDebugOverlay] on [surface] and returns it, or
     *  returns `null` (mounting nothing) when the consuming app is not debuggable. */
    fun createIfDebug(surface: ViewGroup): AutoskeletonDebugOverlay? {
        if (!isDebugBuild(surface.context)) {
            return null
        }
        val overlay = AutoskeletonDebugOverlay(surface.context)
        surface.addView(
            overlay,
            ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
        val widthSpec = View.MeasureSpec.makeMeasureSpec(surface.width, View.MeasureSpec.EXACTLY)
        val heightSpec = View.MeasureSpec.makeMeasureSpec(surface.height, View.MeasureSpec.EXACTLY)
        overlay.measure(widthSpec, heightSpec)
        overlay.layout(0, 0, surface.width, surface.height)
        return overlay
    }
}
