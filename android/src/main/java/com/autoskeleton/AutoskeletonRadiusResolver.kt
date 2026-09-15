package com.autoskeleton

import android.graphics.Outline
import android.view.View
import com.facebook.react.uimanager.BackgroundStyleApplicator
import com.facebook.react.uimanager.LengthPercentageType
import com.facebook.react.uimanager.style.BorderRadiusProp
import kotlin.math.min

// Task 4.2 (tasks.md Phase 4) / plan.md ADR-2: the public-API-only Android corner
// radius degradation ladder, tried in order per shape, first hit wins:
//
//   R0 — explicit typed `radius` hint, carried on the `nativeID` channel. Fully
//        public, authoritative.
//   R1 — `drawable.getOutline(outline)` on a COPY of `view.background`; used when
//        `outline.getRadius() >= 0`. Resolves the "verified square" case (and the
//        no-background case, trivially) exactly. It CANNOT resolve a rounded
//        background: RN's real `CompositeBackgroundDrawable` reports
//        `Outline.RADIUS_UNDEFINED` for anything with corners, verified against
//        the production `BackgroundStyleApplicator` in
//        `AutoskeletonRadiusResolverTest`.
//   R1b — `BackgroundStyleApplicator.getBorderRadius(view, BORDER_RADIUS)`, the
//        symmetric READ of the exact public API that WROTE the radius. This is
//        what closes R1's gap. Until it existed, every rounded view on Android
//        fell to R3 and painted with `defaultRadius` — so a circular avatar
//        (`borderRadius: 28` on a 56dp image) rendered as a near-square block
//        while iOS, which reads `layer.cornerRadius` directly, drew a circle.
//        That was the single most visible defect the library could produce, on
//        the platform with the most devices.
//
//        It is `@JvmStatic public` on a PUBLIC class in both RN 0.77 — this
//        package's declared `peerDependencies` floor — and RN 0.87, so it holds
//        across the whole supported range. ADR-2 forbids naming or downcasting
//        to RN INTERNAL classes (`CompositeBackgroundDrawable`,
//        `BackgroundDrawable`); `BackgroundStyleApplicator` is neither — it is
//        the same public entry point RN's own `ReactViewManager` writes through,
//        and the one this resolver's tests already use to build fixtures.
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
            resolveViaOutline(view)?.let { return it }

            // R1b
            return resolveViaBorderRadiusStyle(view)
        }

        /** Reads the radius back through the same public API that set it.
         *
         *  Reached only when R1 gave up, which is exactly the rounded case — so
         *  this never displaces R1's exact answer for a square or unbacked view.
         *
         *  Only the UNIFORM `BORDER_RADIUS` is honoured. A view styled with four
         *  different corner radii falls through to R3 deliberately: `ShapeInfo.r`
         *  is a single scalar, so picking one corner would paint a shape the view
         *  does not have, and quietly. Falling through keeps the
         *  `radius-unavailable` flag that says so.
         *
         *  A PERCENT radius resolves against `min(width, height)`. CSS resolves
         *  the horizontal and vertical radii against width and height
         *  separately; one scalar cannot carry that, and the shorter side is the
         *  conservative choice — the renderers already clamp to
         *  `min(w, h) / 2`, so it can never over-round. */
        private fun resolveViaBorderRadiusStyle(view: View): AutoskeletonRadiusResolution? {
            val uniform = BackgroundStyleApplicator.getBorderRadius(view, BorderRadiusProp.BORDER_RADIUS)
                ?: return null

            // UNITS, and the two halves are NOT the same unit.
            //
            // A POINT radius is the raw JS number: `ReactViewManager.setBorderRadius`
            // stores `LengthPercentage.setFromDynamic(rawBorderRadius)` with no
            // `toPixelFromDIP` anywhere, so `borderRadius: 28` is 28 **dp**. Every
            // other length this resolver returns is in raw view PIXELS, which is
            // what `AutoskeletonSensor` measures in, so it has to be scaled — the
            // same conversion `AutoskeletonGetShapesConfig.toSensorOptions` already
            // applies to `defaultRadius` and every hint, and for the same reason.
            //
            // A PERCENT radius does not: `LengthPercentage.resolve` multiplies by
            // the reference length we hand it, and we hand it `view.width/height`,
            // which are already pixels. Scaling that too would square the density.
            //
            // Robolectric's default density is 1, so a test alone cannot tell these
            // apart — `r1bScalesADpRadiusToPixelsAtDensity3` is the one that can,
            // and it exists because the device caught this after the unit-blind
            // version shipped a visibly under-rounded avatar.
            val density = view.resources?.displayMetrics?.density?.takeIf { it > 0f } ?: 1f
            val radius = when (uniform.type) {
                LengthPercentageType.PERCENT -> uniform.resolve(min(view.width, view.height).toFloat())
                LengthPercentageType.POINT -> uniform.resolve(0f) * density
            }
            if (!radius.isFinite() || radius <= 0f) {
                return null
            }
            return AutoskeletonRadiusResolution(radius = radius, source = AutoskeletonRadiusSource.STYLE)
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
