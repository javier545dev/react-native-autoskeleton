package com.autoskeleton

import android.content.Context
import android.graphics.drawable.ColorDrawable
import android.view.View
import android.widget.FrameLayout
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import kotlin.math.ceil

/**
 * Task 9.1 (tasks.md Phase 9) — the Android half of REQ-OBS-CI-1's "native
 * traversal (30/60-shape reference screens/platform)" requirement, promoted
 * from `AutoskeletonSensorTest.kt`'s correctness-only fixtures (which never
 * measure timing) into a dedicated timing benchmark.
 *
 * HONEST SCOPE NOTE, stated exactly once here and cross-referenced from the
 * apply-progress report: this runs under Robolectric, i.e. on the HOST JVM,
 * not a real Android device/emulator. Robolectric shadows layout/View/Canvas
 * machinery well enough for the traversal ALGEBRA (see the existing
 * `AutoskeletonSensorTest`), but host-JVM wall-clock timing does not
 * represent real on-device ART performance — a modern dev-machine CPU is
 * categorically faster than a mid-range Android device. This benchmark is
 * therefore a REGRESSION PROXY (did a code change make traversal N times
 * slower than a same-run same-host baseline?), not an authoritative
 * real-device measurement of spec.md NFR-3's absolute "< 2 ms p95" claim.
 * `benchmarks/budgets.json`'s `traversalP95Ms` (2 ms) is still applied here
 * as an absolute ceiling because host-JVM traversal is expected to be
 * FASTER than real-device traversal for the same tree (fewer JIT/GC/thermal
 * constraints), so passing here is necessary but not sufficient — a real
 * on-device benchmark (instrumented `androidTest`, requiring a live
 * emulator/device in CI) remains open work, tracked in
 * `.github/workflows/benchmarks.yml`'s `benchmarks-native-android`
 * job (authored, not executed by this test).
 */
@RunWith(RobolectricTestRunner::class)
class AutoskeletonTraversalPerfTest {

    companion object {
        private const val WARMUP_ITERATIONS = 20
        private const val MEASURED_ITERATIONS = 200
        private const val TRAVERSAL_P95_BUDGET_MS = 2.0 // benchmarks/budgets.json traversalP95Ms
    }

    /** Builds a `FrameLayout` root with exactly `shapeCount` childless View
     *  leaves, each with an opaque `ColorDrawable` background — classified
     *  as a `background` leaf shape by `AutoskeletonSensor` (see
     *  `hasNonTransparentBackground`), mirroring
     *  `benchmarks/web/reference-screen.ts`'s web equivalent exactly (same
     *  "N opaque background leaves under one container" shape). */
    private fun buildReferenceScreen(context: Context, shapeCount: Int): FrameLayout {
        val root = FrameLayout(context)
        root.layout(0, 0, 400, 2000)
        val columns = 6
        repeat(shapeCount) { i ->
            val leaf = View(context)
            leaf.background = ColorDrawable(0xFFCCCCCC.toInt())
            val col = i % columns
            val row = i / columns
            val left = col * 60
            val top = row * 20
            leaf.layout(left, top, left + 50, top + 16)
            root.addView(leaf)
        }
        return root
    }

    private fun p95(samples: List<Double>): Double {
        val sorted = samples.sorted()
        val rank = ceil(0.95 * sorted.size).toInt().coerceIn(1, sorted.size)
        return sorted[rank - 1]
    }

    private fun measureTraversalP95Ms(shapeCount: Int): Double {
        val context = RuntimeEnvironment.getApplication()
        val root = buildReferenceScreen(context, shapeCount)
        val sensor = AutoskeletonSensor()
        val options = AutoskeletonSensorOptions.defaults.copy(maxShapes = shapeCount + 10)

        repeat(WARMUP_ITERATIONS) { sensor.measure(root, options) }

        val samples = (0 until MEASURED_ITERATIONS).map {
            val result = sensor.measure(root, options)
            checkNotNull(result) { "sensor.measure() returned null for a $shapeCount-shape reference screen" }
            result.traversalMs
        }
        return p95(samples)
    }

    @Test
    fun traversalP95AtThirtyShapesIsWithinBudget_hostJvmRegressionProxy() {
        val p95Ms = measureTraversalP95Ms(30)
        println("[benchmarks] Android (Robolectric/host-JVM) traversal p95 @30 shapes: ${p95Ms}ms")
        assert(p95Ms < TRAVERSAL_P95_BUDGET_MS) {
            "Traversal p95 at 30 shapes was ${p95Ms}ms, exceeding the ${TRAVERSAL_P95_BUDGET_MS}ms budget " +
                "(benchmarks/budgets.json traversalP95Ms) — see this file's own class doc for why this is a " +
                "host-JVM regression proxy, not an authoritative real-device measurement."
        }
    }

    @Test
    fun traversalP95AtSixtyShapesIsWithinBudget_hostJvmRegressionProxy() {
        val p95Ms = measureTraversalP95Ms(60)
        println("[benchmarks] Android (Robolectric/host-JVM) traversal p95 @60 shapes: ${p95Ms}ms")
        assert(p95Ms < TRAVERSAL_P95_BUDGET_MS) {
            "Traversal p95 at 60 shapes was ${p95Ms}ms, exceeding the ${TRAVERSAL_P95_BUDGET_MS}ms budget " +
                "(benchmarks/budgets.json traversalP95Ms)."
        }
    }
}
