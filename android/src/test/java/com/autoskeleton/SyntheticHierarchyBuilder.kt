package com.autoskeleton

import android.content.Context
import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ScrollView
import com.facebook.react.uimanager.BackgroundStyleApplicator
import com.facebook.react.uimanager.DisplayMetricsHolder
import com.facebook.react.uimanager.LengthPercentage
import com.facebook.react.uimanager.LengthPercentageType
import com.facebook.react.uimanager.style.BorderRadiusProp
import com.facebook.react.views.text.ReactTextView
import org.json.JSONObject
import org.robolectric.RuntimeEnvironment
import java.io.File

/**
 * Task 4.1 (tasks.md Phase 4) / plan.md §7.1/§7.2a: test-target-only harness that
 * builds a real, explicitly-laid-out Android view hierarchy from the SAME shared
 * JSON fixtures the iOS (`SyntheticHierarchyBuilder.swift`) and web sensor tests
 * consume — the golden-parity mechanism plan.md §7.1 names explicitly.
 *
 * Robolectric performs no real layout pass (plan.md §7.2a), so every frame is set
 * explicitly via `view.layout(l, t, r, b)` rather than relying on a measure/layout
 * cycle, exactly as `AutoskeletonSensorTest` expects.
 *
 * **Real leaf classes, real background drawables — no reflection, no internal API.**
 * `ReactTextView` has a simple public single-`Context` constructor and is used
 * directly. `ReactImageView` and `ReactEditText` do NOT construct cleanly outside a
 * live RN bridge — `ReactImageView`'s only public constructor requires a Fresco
 * `AbstractDraweeControllerBuilder`, and `ReactEditText`'s single-`Context`
 * constructor compiles but throws at runtime (`setText` -> `onContentSizeChange` ->
 * `UIManagerHelper.getReactContext` casts the plain Robolectric `Application`
 * context to `ReactContext` and fails) — both verified empirically, not assumed.
 * No shared fixture currently declares an `"image"` or `"input"` node, so this
 * harness intentionally does not support either yet (see `AutoskeletonSensorTest`'s
 * classification note for where that coverage lives instead). Backgrounds and
 * corner radii are applied via the exact same public
 * `BackgroundStyleApplicator` RN's own `ReactViewManager` uses in production
 * (verified empirically: it produces a real `CompositeBackgroundDrawable`, and a
 * fully-transparent color collapses `view.background` to `null` — exactly the
 * "has a background" signal `AutoskeletonSensor`'s container rule needs) — this is
 * what makes task 4.2's R1 characterization test genuine rather than a synthetic
 * stand-in.
 */
object SyntheticHierarchyBuilder {
    data class ExpectedShape(
        val x: Float,
        val y: Float,
        val w: Float,
        val h: Float,
        val r: Float,
        val source: String,
    )

    /** Walks up from the JVM process's working directory until it finds the shared
     *  fixtures directory, so this works whether Gradle's test working directory is
     *  the real repo root or a symlinked path that resolves to it (both were
     *  observed empirically to already canonicalize to the real repo path). */
    private val repoRoot: File by lazy {
        var dir: File? = File(System.getProperty("user.dir")!!).canonicalFile
        while (dir != null) {
            if (File(dir, "test/fixtures/hierarchies").isDirectory) {
                return@lazy dir
            }
            dir = dir.parentFile
        }
        error(
            "could not locate repo root containing test/fixtures/hierarchies from " +
                System.getProperty("user.dir"),
        )
    }

    private val fixturesDirectory get() = File(repoRoot, "test/fixtures/hierarchies")
    private val expectedDirectory get() = File(repoRoot, "test/fixtures/expected")

    fun loadFixture(name: String): JSONObject = JSONObject(File(fixturesDirectory, "$name.json").readText())

    fun loadExpected(name: String): List<ExpectedShape> {
        val json = JSONObject(File(expectedDirectory, "$name.json").readText())
        val shapes = json.getJSONArray("shapes")
        return (0 until shapes.length()).map { i ->
            val s = shapes.getJSONObject(i)
            ExpectedShape(
                x = s.getDouble("x").toFloat(),
                y = s.getDouble("y").toFloat(),
                w = s.getDouble("w").toFloat(),
                h = s.getDouble("h").toFloat(),
                r = s.getDouble("r").toFloat(),
                source = s.getString("source"),
            )
        }
    }

    /** Builds the fixture into a real, explicitly-laid-out view hierarchy and
     *  returns the root view, ready for `AutoskeletonSensor.measure(root:)`. */
    fun build(fixture: JSONObject): View {
        DisplayMetricsHolder.initDisplayMetricsIfNotInitialized(RuntimeEnvironment.getApplication())
        val root = makeView(RuntimeEnvironment.getApplication(), fixture)
        layoutSubtree(root, fixture)
        return root
    }

    private fun makeView(context: Context, fixture: JSONObject): View {
        val view: View = when (fixture.optString("class", "container")) {
            "text" -> ReactTextView(context)
            "input" -> error(
                "SyntheticHierarchyBuilder does not support the \"input\" fixture class: " +
                    "ReactEditText's constructor requires a live ReactContext (it calls " +
                    "UIManagerHelper.getReactContext during setText) — verified empirically not to " +
                    "be worth constructing for a fast traversal-algebra unit harness (see this " +
                    "file's class doc). No shared fixture currently needs it.",
            )
            "image" -> error(
                "SyntheticHierarchyBuilder does not support the \"image\" fixture class: " +
                    "ReactImageView has no simple public constructor (see this file's class doc). " +
                    "No shared fixture currently needs it.",
            )
            // Android's ScrollView has no independent "contentSize" concept the way
            // UIScrollView does (plan.md's iOS harness sets `contentSize` directly) —
            // its scrollable range is derived from its single child's actual
            // measured/laid-out size. So a "scroll" fixture node gets a synthetic
            // content wrapper, sized to the fixture's declared `contentSize`, as the
            // ScrollView's sole child; the fixture's own `children` are attached to
            // THAT wrapper, not to the ScrollView directly. This wrapper is
            // semantically transparent to `AutoskeletonSensor` (no background, no
            // nativeID — the container rule simply passes its leaves through).
            "scroll" -> {
                val scrollView = ScrollView(context).apply { isVerticalScrollBarEnabled = false }
                val contentSize = fixture.optJSONObject("contentSize")
                val frame = fixture.getJSONObject("frame")
                val contentW = contentSize?.getDouble("x")?.toInt() ?: frame.getDouble("w").toInt()
                val contentH = contentSize?.getDouble("y")?.toInt() ?: frame.getDouble("h").toInt()
                val content = FrameLayout(context)
                content.layout(0, 0, contentW, contentH)
                scrollView.addView(content)
                for (i in 0 until fixture.optJSONArray("children")?.length().orZero()) {
                    val childFixture = fixture.getJSONArray("children").getJSONObject(i)
                    content.addView(makeView(context, childFixture))
                }
                return scrollView.also { applyStyle(it, fixture) }
            }
            else -> FrameLayout(context)
        }

        applyStyle(view, fixture)

        if (view is ViewGroup) {
            for (i in 0 until fixture.optJSONArray("children")?.length().orZero()) {
                val childFixture = fixture.getJSONArray("children").getJSONObject(i)
                view.addView(makeView(context, childFixture))
            }
        }

        return view
    }

    private fun applyStyle(view: View, fixture: JSONObject) {
        val frame = fixture.getJSONObject("frame")
        val l = frame.getDouble("x").toInt()
        val t = frame.getDouble("y").toInt()
        val w = frame.getDouble("w").toInt()
        val h = frame.getDouble("h").toInt()
        view.layout(l, t, l + w, t + h)

        if (fixture.has("backgroundColor")) {
            BackgroundStyleApplicator.setBackgroundColor(view, Color.parseColor(fixture.getString("backgroundColor")))
        }
        if (fixture.has("cornerRadius")) {
            BackgroundStyleApplicator.setBorderRadius(
                view,
                BorderRadiusProp.BORDER_RADIUS,
                LengthPercentage(fixture.getDouble("cornerRadius").toFloat(), LengthPercentageType.POINT),
            )
        }
        view.background?.setBounds(0, 0, view.width, view.height)
        if (fixture.has("nativeID")) {
            view.setTag(com.facebook.react.R.id.view_tag_native_id, fixture.getString("nativeID"))
        }
    }

    /** Robolectric performs no real layout pass, so child frames must be assigned
     *  explicitly, depth-first, exactly mirroring the iOS harness's
     *  `layoutSubtree`. Re-applies each node's own frame (already set once in
     *  `makeView`/`applyStyle`) defensively before descending, then re-applies the
     *  scroll offset AFTER children are laid out — `ScrollView.scrollTo` before
     *  children exist has nothing to clamp against yet on some Robolectric
     *  versions, mirroring the exact `contentSize`-before-`contentOffset` ordering
     *  hazard the iOS harness already documented for `UIScrollView`. */
    private fun layoutSubtree(view: View, fixture: JSONObject) {
        val frame = fixture.getJSONObject("frame")
        val l = frame.getDouble("x").toInt()
        val t = frame.getDouble("y").toInt()
        val w = frame.getDouble("w").toInt()
        val h = frame.getDouble("h").toInt()
        view.layout(l, t, l + w, t + h)

        if (view is ScrollView) {
            // Descend into the synthetic content wrapper (see `makeView`'s "scroll"
            // branch) rather than the fixture's own `children`, which are attached
            // to that wrapper, not to the ScrollView directly.
            val content = view.getChildAt(0) as ViewGroup
            val contentSize = fixture.optJSONObject("contentSize")
            val contentW = contentSize?.getDouble("x")?.toInt() ?: w
            val contentH = contentSize?.getDouble("y")?.toInt() ?: h
            content.layout(0, 0, contentW, contentH)
            val children = fixture.optJSONArray("children")
            for (i in 0 until (children?.length() ?: 0)) {
                layoutSubtree(content.getChildAt(i), children!!.getJSONObject(i))
            }
            // `scrollTo` must run AFTER the content wrapper (and its children) have
            // their real size, since Android's ScrollView clamps the requested
            // offset to `max(0, contentHeight - viewportHeight)` computed from its
            // single child's actual laid-out height.
            fixture.optJSONObject("contentOffset")?.let { offset ->
                view.scrollTo(offset.getDouble("x").toInt(), offset.getDouble("y").toInt())
            }
            return
        }

        if (view is ViewGroup) {
            val children = fixture.optJSONArray("children")
            for (i in 0 until (children?.length() ?: 0)) {
                layoutSubtree(view.getChildAt(i), children!!.getJSONObject(i))
            }
        }
    }
}

private fun Int?.orZero(): Int = this ?: 0
