package com.autoskeleton

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.widget.FrameLayout
import com.facebook.react.uimanager.BackgroundStyleApplicator
import com.facebook.react.uimanager.DisplayMetricsHolder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.GraphicsMode
import kotlin.math.abs

/**
 * Task 4.3 (tasks.md Phase 4) / plan.md ADR-2 rung R2. Two things are proven here,
 * on the JVM, without a device:
 *
 * 1. The scan ALGORITHM itself is correct against a drawable that DOES support
 *    `getConstantState()` (`GradientDrawable` — unlike RN's real
 *    `CompositeBackgroundDrawable`, confirmed `null` in task 4.2's own tests). This
 *    is a real, if incomplete, proof: it cannot validate R2 against production RN
 *    views (that needs a real bridge/device — `AutoskeletonRadiusLadderInstrumentedTest`,
 *    the authoritative on-device gate per plan.md §7.2b).
 * 2. R2 structurally never runs inside `measure()` — only `refine()` can reach it.
 *
 * `@GraphicsMode(NATIVE)` is required: this module's default Robolectric graphics
 * mode does not actually rasterize `Canvas`/`Bitmap` draw calls (verified
 * empirically — every pixel reads back fully transparent under the default mode,
 * even for an opaque `GradientDrawable`), which would make every raster-probe
 * assertion here pass or fail for the wrong reason.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AutoskeletonRasterProbeTest {
    private fun freshView(widthPx: Int = 100, heightPx: Int = 100): FrameLayout {
        val context = RuntimeEnvironment.getApplication()
        DisplayMetricsHolder.initDisplayMetricsIfNotInitialized(context)
        val view = FrameLayout(context)
        view.layout(0, 0, widthPx, heightPx)
        return view
    }

    /** A `GradientDrawable` DOES implement `getConstantState()`, so this is the one
     *  drawable type that can actually reach R2's rasterization path in a fast JVM
     *  test — real RN views cannot (task 4.2's finding), which is exactly why the
     *  on-device suite is the authoritative gate, not this test. */
    private fun gradientBackground(view: FrameLayout, radiusPx: Float) {
        val drawable = GradientDrawable().apply {
            setColor(Color.RED)
            cornerRadius = radiusPx
        }
        view.background = drawable
        view.background.setBounds(0, 0, view.width, view.height)
    }

    // MARK: - Scan algorithm correctness (against a constantState-having drawable)

    @Test
    fun recoversExactRadiusForASquareGradientBackground() {
        val view = freshView()
        gradientBackground(view, radiusPx = 0f)
        val probe = AutoskeletonRasterProbe()
        val resolution = probe.probe(view, view.width, view.height)!!
        assertEquals(AutoskeletonRadiusSource.RASTER_PROBE, resolution.source)
        assertTrue("expected ~0, got ${resolution.radius}", abs(resolution.radius) <= 2f)
    }

    @Test
    fun recoversApproximateRadiusForARoundedGradientBackground() {
        val view = freshView()
        gradientBackground(view, radiusPx = 12f)
        val probe = AutoskeletonRasterProbe()
        val resolution = probe.probe(view, view.width, view.height)!!
        assertEquals(AutoskeletonRadiusSource.RASTER_PROBE, resolution.source)
        assertTrue("expected ~12 (±4px quantization tolerance), got ${resolution.radius}", abs(resolution.radius - 12f) <= 4f)
    }

    @Test
    fun returnsNullWhenNoBackgroundExists() {
        val view = freshView()
        val probe = AutoskeletonRasterProbe()
        assertNull(probe.probe(view, view.width, view.height))
    }

    // MARK: - ADR-2 skip condition: getConstantState() == null (RN's real drawable)

    @Test
    fun skipsHonestlyWhenConstantStateIsNull() {
        val view = freshView()
        BackgroundStyleApplicator.setBackgroundColor(view, Color.RED)
        view.background?.setBounds(0, 0, view.width, view.height)
        val probe = AutoskeletonRasterProbe()
        assertNull(probe.probe(view, view.width, view.height))
        assertEquals(0, probe.attemptedProbeCount)
    }

    // MARK: - Memoization by (ConstantState identity, bounds)

    @Test
    fun memoizesByConstantStateIdentityAndBounds() {
        val view = freshView()
        gradientBackground(view, radiusPx = 8f)
        val probe = AutoskeletonRasterProbe()
        val first = probe.probe(view, view.width, view.height)
        assertEquals(1, probe.attemptedProbeCount)
        val second = probe.probe(view, view.width, view.height)
        assertEquals("a repeated probe for the same ConstantState+bounds must be a cache hit", 1, probe.attemptedProbeCount)
        assertEquals(first, second)
    }

    @Test
    fun differentBoundsAreNotMemoizedTogether() {
        val view = freshView()
        gradientBackground(view, radiusPx = 8f)
        val probe = AutoskeletonRasterProbe()
        probe.probe(view, 100, 100)
        probe.probe(view, 50, 50)
        assertEquals(2, probe.attemptedProbeCount)
    }

    // MARK: - maxProbesPerTraversal cap

    @Test
    fun capsProbesPerTraversal() {
        val probe = AutoskeletonRasterProbe(maxProbesPerTraversal = 2)
        probe.beginTraversal()
        repeat(5) { i ->
            val view = freshView()
            gradientBackground(view, radiusPx = (i + 1).toFloat()) // distinct ConstantState each time
            probe.probe(view, view.width, view.height)
        }
        assertEquals(2, probe.attemptedProbeCount)
    }

    @Test
    fun beginTraversalResetsTheBudgetButNotTheCache() {
        val probe = AutoskeletonRasterProbe(maxProbesPerTraversal = 1)
        val view = freshView()
        gradientBackground(view, radiusPx = 8f)

        probe.beginTraversal()
        val first = probe.probe(view, view.width, view.height)
        assertEquals(1, probe.attemptedProbeCount)

        // A second view exceeds this traversal's budget of 1.
        val secondView = freshView()
        gradientBackground(secondView, radiusPx = 4f)
        assertNull(probe.probe(secondView, secondView.width, secondView.height))
        assertEquals(1, probe.attemptedProbeCount)

        probe.beginTraversal() // new traversal: budget resets
        assertEquals(
            "the same view/bounds must stay a cache hit across traversals",
            first,
            probe.probe(view, view.width, view.height),
        )
        assertEquals(1, probe.attemptedProbeCount) // still a cache hit, no new rasterization
    }

    // MARK: - R2 never runs inside measure() — only refine() can reach it

    @Test
    fun measureNeverTouchesTheRasterProbe() {
        val fixture = SyntheticHierarchyBuilder.loadFixture("container-rule-no-leaves")
        val root = SyntheticHierarchyBuilder.build(fixture)
        val sensor = AutoskeletonSensor()
        val probe = AutoskeletonRasterProbe()

        // Even when a full-ladder resolver referencing this exact probe instance
        // exists, measure() itself never calls it unless the caller explicitly
        // wires it in via options — the production `measure()` call from the
        // interaction frame never does. This test asserts the DEFAULT path.
        sensor.measure(root, AutoskeletonSensorOptions.defaults.copy(budgetMs = 1000.0))
        assertEquals(0, probe.attemptedProbeCount)
    }

    @Test
    fun refineRecoversRasterProbeSourcedRadiusForAConstantStateHavingBackground() {
        // NOT `gradientBackground`: `GradientDrawable.getOutline()` is well-behaved
        // and correctly reports its own configured corner radius, so R1 would
        // resolve it directly and R2 would never even be attempted — that's real,
        // correct behavior, but it means GradientDrawable can't exercise R2's own
        // code path. `OutlineBlindRoundedDrawable` below has a `ConstantState` (so
        // R2 CAN attempt it, unlike RN's real background drawable — task 4.2's
        // finding) but leaves `getOutline()` un-overridden, so `Outline.getRadius()`
        // stays at its constructor default (`RADIUS_UNDEFINED`) exactly like the
        // characterized RN "rounded" case — the one case R2 exists to help with.
        val view = freshView()
        view.background = OutlineBlindRoundedDrawable(radiusPx = 8f).also {
            it.setBounds(0, 0, view.width, view.height)
        }
        val sensor = AutoskeletonSensor()
        val probe = AutoskeletonRasterProbe()

        val refined = sensor.refine(view, AutoskeletonSensorOptions.defaults.copy(budgetMs = 1000.0), probe)!!
        assertTrue(probe.attemptedProbeCount > 0)
        assertTrue(refined.shapes.any { it.radiusSource == AutoskeletonRadiusSource.RASTER_PROBE })
    }
}

/** Test-only drawable: paints a real rounded rect (so the raster probe has real
 *  corner geometry to scan) and — like RN's real `CompositeBackgroundDrawable`
 *  (brief §2's ground truth, task 4.2's characterization test) — reports its
 *  outline via `Outline.setPath(Path)` rather than `setRoundRect`, so
 *  `Outline.getRadius()` stays `RADIUS_UNDEFINED`. **Verified empirically that this
 *  override is required**: a `Drawable` subclass that does NOT override
 *  `getOutline()` at all inherits a base implementation that calls
 *  `outline.setRect(bounds)` (radius `0`, NOT undefined) — only RN's specific
 *  `setPath`-based override produces the undefined case, so a faithful test double
 *  must reproduce that override explicitly, not merely omit it. Unlike RN's real
 *  drawable, this one HAS a `ConstantState` (task 4.2's finding is exactly that RN's
 *  does not), which is what lets it reach R2's code path in this JVM test. */
private class OutlineBlindRoundedDrawable(private val radiusPx: Float) : android.graphics.drawable.Drawable() {
    private val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.RED
    }

    override fun draw(canvas: android.graphics.Canvas) {
        val rect = android.graphics.RectF(bounds)
        canvas.drawRoundRect(rect, radiusPx, radiusPx, paint)
    }

    override fun getOutline(outline: android.graphics.Outline) {
        val path = android.graphics.Path().apply {
            addRoundRect(android.graphics.RectF(bounds), radiusPx, radiusPx, android.graphics.Path.Direction.CW)
        }
        outline.setPath(path)
    }

    override fun setAlpha(alpha: Int) = Unit
    override fun setColorFilter(colorFilter: android.graphics.ColorFilter?) = Unit

    @Suppress("DEPRECATION")
    @Deprecated("Deprecated in Java", ReplaceWith("android.graphics.PixelFormat.TRANSLUCENT"))
    override fun getOpacity(): Int = android.graphics.PixelFormat.TRANSLUCENT

    override fun getConstantState(): ConstantState = object : ConstantState() {
        override fun newDrawable() = OutlineBlindRoundedDrawable(radiusPx)
        override fun getChangingConfigurations() = 0
    }
}
