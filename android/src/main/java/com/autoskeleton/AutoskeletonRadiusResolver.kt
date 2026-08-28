package com.autoskeleton

import android.graphics.Outline
import android.view.View

// Task 4.2 (tasks.md Phase 4) / plan.md ADR-2: the public-API-only Android corner
// radius degradation ladder, tried in order per shape, first hit wins:
//
//   R0 — explicit typed `radius` hint, carried on the `nativeID` channel. Fully
//        public, authoritative.
//   R1 — `drawable.getOutline(outline)` on a COPY of `view.background`; used when
//        `outline.getRadius() >= 0`. Resolves the "verified square" case (and the
//        no-background case, trivially) exactly; leaves the "rounded, unknown
//        amount" case honestly unresolved, per the characterization documented on
//        `AutoskeletonRadiusResolverTest` — this is current RN 0.87.1 behavior
//        (brief §2), not a bug in this resolver.
//   R3 — `defaultRadius` fallback, with `radius-unavailable` raised. The library
//        still ships a skeleton; it is just honest about not knowing the exact
//        radius.
//
// R2 (the raster corner probe) is deliberately NOT here — it is task 4.3's job,
// gated behind on-device validation (plan.md §7.2b/§10), and plugs in as a
// SEPARATE `refine()`-time resolver layered on top of this one's R3 answer, never
// inside this synchronous `resolve()` call (R2 must never run inside the
// traversal/`measure()` budget).
//
// No RN internal class (`CompositeBackgroundDrawable`, `BackgroundDrawable`) is
// named or downcast to anywhere in this file — only the public `View.background`,
// `Drawable.getOutline`/`getConstantState`, and `Outline.getRadius` APIs, per ADR-2's
// "internal-class access rejected" decision.
class AutoskeletonPublicApiRadiusResolver(
    private val defaultRadius: Float = 0f,
) : AutoskeletonRadiusResolver {

    override fun resolve(
        view: View,
        hints: AutoskeletonHintRegistry,
        nodeId: String?,
    ): AutoskeletonRadiusResolution {
        resolveViaHintOrOutline(view, hints, nodeId)?.let { return it }

        // R3
        return AutoskeletonRadiusResolution(
            radius = defaultRadius,
            source = AutoskeletonRadiusSource.DEFAULT,
            degraded = AutoskeletonDegradationFlag.RADIUS_UNAVAILABLE,
        )
    }

    companion object {
        /** R0 -> R1 only, shared with `AutoskeletonFullLadderRadiusResolver` (task
         *  4.3), which layers R2 in between this and its own R3 fallback. Returns
         *  `null` when neither rung can answer — the caller decides what happens
         *  next. */
        fun resolveViaHintOrOutline(
            view: View,
            hints: AutoskeletonHintRegistry,
            nodeId: String?,
        ): AutoskeletonRadiusResolution? {
            // R0
            val hintRadius = nodeId?.let(hints::radius)
            if (hintRadius != null) {
                return AutoskeletonRadiusResolution(radius = hintRadius, source = AutoskeletonRadiusSource.HINT)
            }

            // R1
            return resolveViaOutline(view)
        }

        /** Returns a resolution when R1 can answer definitively (no background at
         *  all -> trivially square/`MEASURED`; a background whose outline reports a
         *  non-negative radius -> `OUTLINE`), or `null` to fall through (a
         *  background exists but its outline is undefined).
         *
         *  **Deviation from plan.md's literal "on a copy" wording, stated and
         *  verified, not silent**: `CompositeBackgroundDrawable.getConstantState()`
         *  returns `null` for RN's real production background drawable (verified
         *  empirically against RN 0.87.1 — `Drawable`'s default `getConstantState()`
         *  implementation, which RN does not override for this class), so
         *  `getConstantState().newDrawable().mutate()` — the exact mechanism R2's
         *  raster probe legitimately needs, since `draw(Canvas)` can have real side
         *  effects — is not achievable here at all. `getOutline(Outline)` is a
         *  different, read-only QUERY API by contract: it only populates the
         *  `Outline` instance the caller passes in and never mutates the drawable's
         *  own state, which is exactly why Android's own `View.getOutline()` default
         *  implementation calls it directly on the live `background` with no copy in
         *  between. R1 therefore reads the live drawable directly; only R2 (task
         *  4.3) needs — and gets — an isolated copy. */
        private fun resolveViaOutline(view: View): AutoskeletonRadiusResolution? {
            val background = view.background
                ?: return AutoskeletonRadiusResolution(radius = 0f, source = AutoskeletonRadiusSource.MEASURED)

            val outline = Outline()
            background.getOutline(outline)
            val radius = outline.radius
            return if (radius >= 0f) {
                AutoskeletonRadiusResolution(radius = radius, source = AutoskeletonRadiusSource.OUTLINE)
            } else {
                null
            }
        }
    }
}

/** Task 4.3 (tasks.md Phase 4) / plan.md ADR-2: the FULL ladder — R0 -> R1 -> R2 ->
 *  R3 — used ONLY by `AutoskeletonSensor.refine()`, never by `measure()`. Layering
 *  R2 strictly between the shared R0/R1 logic and its own R3 fallback is what keeps
 *  R2 impossible to reach from the traversal/`measure()` budget: nothing in
 *  `measure()`'s own code path ever references `AutoskeletonRasterProbe` at all. */
class AutoskeletonFullLadderRadiusResolver(
    private val rasterProbe: AutoskeletonRasterProbe = AutoskeletonRasterProbe(),
    private val defaultRadius: Float = 0f,
) : AutoskeletonRadiusResolver {
    override fun resolve(
        view: View,
        hints: AutoskeletonHintRegistry,
        nodeId: String?,
    ): AutoskeletonRadiusResolution {
        AutoskeletonPublicApiRadiusResolver.resolveViaHintOrOutline(view, hints, nodeId)?.let { return it }

        // R2
        rasterProbe.probe(view, view.width, view.height)?.let { return it }

        // R3, with the R2-specific failure flag (plan.md: "raise radius-probe-failed
        // and fall to R3") rather than R1's radius-unavailable — R2 was genuinely
        // attempted and could not classify the drawable, a distinct fact from R1
        // never having attempted anything.
        return AutoskeletonRadiusResolution(
            radius = defaultRadius,
            source = AutoskeletonRadiusSource.DEFAULT,
            degraded = AutoskeletonDegradationFlag.RADIUS_PROBE_FAILED,
        )
    }
}
