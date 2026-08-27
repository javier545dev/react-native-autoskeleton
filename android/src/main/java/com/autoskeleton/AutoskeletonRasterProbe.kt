package com.autoskeleton

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.view.View
import kotlin.math.min
import kotlin.math.sqrt

// Task 4.3 (tasks.md Phase 4) / plan.md ADR-2 rung R2, §6, §7.2b: the raster
// corner probe. **A DESIGN PROPOSAL, not a verified fact** until the instrumented
// on-device suite (`AutoskeletonRadiusLadderInstrumentedTest`) validates it against
// real RN views across the RN version/API-level matrix actually available in this
// environment (plan.md §10: "STOP and propose alternatives with trade-offs rather
// than silently shipping a degraded detector"). Only ever invoked from
// `AutoskeletonSensor.refine()` via `AutoskeletonFullLadderRadiusResolver` — never
// from `measure()` — so it is never counted against the NFR-3 traversal budget.
//
// Mechanism: copy the background drawable via `getConstantState().newDrawable()`
// (never the live instance — `draw(Canvas)` can have real side effects, unlike R1's
// read-only `getOutline()`), rasterize it into a library-owned `ARGB_8888` bitmap,
// and scan the top-left diagonal for the alpha transition that marks the rounded
// corner's edge.
//
// Diagonal-scan geometry: for a corner of true radius `r` (in probe-pixel units)
// centered at `(r, r)`, a point `(i, i)` on the diagonal lies OUTSIDE the rounded
// corner (i.e. is clipped/transparent) exactly while
// `sqrt(2) * (r - i) > r`, i.e. `i < r * (1 - 1/sqrt(2))`. The first opaque sample
// therefore appears at `transitionIndex ~= r * (1 - 1/sqrt(2))`, so
// `r ~= transitionIndex * (2 + sqrt(2))` (the reciprocal of `1 - 1/sqrt(2)`) is the
// probe's radius estimate. This is a best-effort geometric inverse, not a promise
// of sub-pixel accuracy — the instrumented suite is what measures the REAL achieved
// accuracy against `±2 px`, not this derivation.
class AutoskeletonRasterProbe(
    private val probeSizePx: Int = 48,
    private val maxProbesPerTraversal: Int = 8,
) {
    private val cache = mutableMapOf<CacheKey, AutoskeletonRadiusResolution>()
    private var probesThisTraversal = 0
    private var probeCallCount = 0

    /** Test/telemetry seam: total number of times [probe] actually attempted a
     *  rasterization (cache hits and budget-skips do not count) — used by
     *  `AutoskeletonRasterProbeTest` to prove R2 never runs inside `measure()`. */
    val attemptedProbeCount: Int get() = probeCallCount

    /** Resets the per-traversal probe budget. Called once per `refine()` pass — the
     *  memoization cache itself is NOT cleared here, since `(ConstantState identity,
     *  bounds)` legitimately spans traversals (the same background drawable being
     *  reused across mounts/re-renders is the common case this cache exists for). */
    fun beginTraversal() {
        probesThisTraversal = 0
    }

    /** Attempts to recover `view`'s corner radius by rasterizing a copy of its
     *  background. Returns `null` when the probe cannot even be attempted or could
     *  not classify the result — callers fall back to R3 and raise
     *  `radius-probe-failed` themselves, exactly like R1 falling through to R3. */
    fun probe(view: View, boundsWidth: Int, boundsHeight: Int): AutoskeletonRadiusResolution? {
        val background = view.background ?: return null
        // ADR-2: "Skipped when getConstantState() returns null" — an honest skip,
        // not a crash. Verified empirically (task 4.2's finding): this is true for
        // RN's real `CompositeBackgroundDrawable` on every production view, which is
        // exactly the on-device suite's central question.
        val constantState = background.constantState ?: return null

        val key = CacheKey(constantState, boundsWidth, boundsHeight)
        cache[key]?.let { return it }

        if (probesThisTraversal >= maxProbesPerTraversal) {
            return null
        }
        probesThisTraversal += 1
        probeCallCount += 1

        val resolution = runCatching { rasterize(constantState, boundsWidth, boundsHeight) }.getOrNull()
        if (resolution != null) {
            cache[key] = resolution
        }
        return resolution
    }

    private fun rasterize(
        constantState: Drawable.ConstantState,
        boundsWidth: Int,
        boundsHeight: Int,
    ): AutoskeletonRadiusResolution? {
        val probeW = min(probeSizePx, boundsWidth)
        val probeH = min(probeSizePx, boundsHeight)
        if (probeW <= 0 || probeH <= 0) {
            return null
        }

        val copy = constantState.newDrawable().mutate()
        // Bounds are set to the REAL view size (not the smaller probe bitmap size)
        // so the drawn corner curvature matches production geometry; only the
        // top-left `probeW x probeH` corner is actually rasterized/read back.
        copy.setBounds(0, 0, boundsWidth, boundsHeight)

        val bitmap = Bitmap.createBitmap(probeW, probeH, Bitmap.Config.ARGB_8888)
        try {
            copy.draw(Canvas(bitmap))
            val radiusPx = scanDiagonalForRadius(bitmap, probeW, probeH) ?: return null
            return AutoskeletonRadiusResolution(radius = radiusPx, source = AutoskeletonRadiusSource.RASTER_PROBE)
        } finally {
            bitmap.recycle()
        }
    }

    /** Returns `null` when the diagonal is fully transparent throughout (an
     *  unclassifiable alpha profile — e.g. an image/gradient background — per
     *  ADR-2's "raise radius-probe-failed" case), else the estimated radius in
     *  pixels (`0f` for a corner that is opaque at index 0, i.e. a verified square
     *  corner — a successful read, not a failure). */
    private fun scanDiagonalForRadius(bitmap: Bitmap, w: Int, h: Int): Float? {
        val n = min(w, h)
        for (i in 0 until n) {
            val alpha = (bitmap.getPixel(i, i) ushr 24) and 0xFF
            if (alpha > 0) {
                return i * RADIUS_SCALE
            }
        }
        return null
    }

    private data class CacheKey(val constantState: Drawable.ConstantState, val w: Int, val h: Int)

    companion object {
        // 1 / (1 - 1/sqrt(2)) == 2 + sqrt(2), see this file's class doc.
        private val RADIUS_SCALE: Float = (2.0 + sqrt(2.0)).toFloat()
    }
}

/** Task 4.3's on-device validation gate (plan.md §6 ADR-2, §7.2b, §10).
 *
 * `rasterProbeEnabledByDefault = false`: the instrumented on-device suite
 * (`AutoskeletonRadiusLadderInstrumentedTest`, run on a real emulator against real
 * mounted RN views) confirmed `CompositeBackgroundDrawable.getConstantState()`
 * returns `null` on-device exactly as it does under Robolectric (task 4.2's
 * finding) — for EVERY tested radius case (0, 4, 12, 24, 9999/pill). R2's own
 * documented skip condition ("Skipped when getConstantState() returns null...
 * raise radius-probe-failed and fall to R3") therefore applies to every real
 * production shape, every time: R2 cannot be validated as recovering any radius
 * because it never gets to attempt a probe at all against RN's real background
 * drawable on this RN version.
 *
 * Per plan.md §10's already-defined fallback, this is a config flip, not a
 * redesign: the ladder collapses to R0 -> R1 -> R3, identical to what task 4.2
 * shipped and to `measure()`'s own resolution — degraded but honest, the library
 * still ships. Flip this back to `true` (or pass `enableRasterProbe = true`
 * directly to `AutoskeletonSensor.refine()`) only after a future RN version is
 * re-validated against the instrumented suite and found to expose a
 * `ConstantState`-having background drawable. */
object AutoskeletonRadiusLadderConfig {
    const val rasterProbeEnabledByDefault: Boolean = false
}
