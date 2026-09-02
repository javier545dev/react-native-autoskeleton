package com.autoskeleton

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.viewmanagers.AutoskeletonOverlayViewManagerDelegate
import com.facebook.react.viewmanagers.AutoskeletonOverlayViewManagerInterface

// Visual-paint-gate remediation (tasks.md Phase 5, task 5.7 follow-up) /
// plan.md ADR-5, ADR-9: the Fabric ViewManager for "AutoskeletonOverlayView"
// (the codegen'd component `src/native/AutoskeletonOverlayNativeComponent.ts`
// registers). `codegenConfig.type: "all"` (previously "modules") makes
// codegen emit `AutoskeletonOverlayViewManagerInterface`/`Delegate` — this
// class implements the former and delegates prop dispatch to the latter,
// the standard Fabric-component pattern. Registered via a real
// `createViewManagers` override in `AutoskeletonPackage` (previously
// absent — `BaseReactPackage` returns an empty view manager list by
// default, which is the other half of why nothing painted before this
// change).
class AutoskeletonOverlayViewManager :
    SimpleViewManager<AutoskeletonOverlayView>(),
    AutoskeletonOverlayViewManagerInterface<AutoskeletonOverlayView> {

    private val delegate: ViewManagerDelegate<AutoskeletonOverlayView> =
        AutoskeletonOverlayViewManagerDelegate(this)

    override fun getName(): String = REACT_CLASS

    override fun getDelegate(): ViewManagerDelegate<AutoskeletonOverlayView> = delegate

    override fun createViewInstance(context: ThemedReactContext): AutoskeletonOverlayView =
        AutoskeletonOverlayView(context)

    override fun onDropViewInstance(view: AutoskeletonOverlayView) {
        view.destroy()
        super.onDropViewInstance(view)
    }

    override fun setCacheKey(view: AutoskeletonOverlayView, value: String?) {
        view.cacheKey = value
    }

    override fun setBaseColor(view: AutoskeletonOverlayView, value: String?) {
        view.baseColor = value
    }

    override fun setHighlightColor(view: AutoskeletonOverlayView, value: String?) {
        view.highlightColor = value
    }

    override fun setDefaultRadius(view: AutoskeletonOverlayView, value: Double) {
        view.defaultRadius = value
    }

    override fun setSpeedMs(view: AutoskeletonOverlayView, value: Double) {
        view.speedMs = value
    }

    override fun setAnimation(view: AutoskeletonOverlayView, value: String?) {
        view.animation = value ?: "shimmer"
    }

    override fun setReducedMotion(view: AutoskeletonOverlayView, value: Boolean) {
        view.reducedMotion = value
    }

    override fun setWritingDirection(view: AutoskeletonOverlayView, value: String?) {
        // Null is the "prop absent" case Fabric hands a nullable string prop;
        // `WithDefault<..., 'ltr'>` in the codegen spec means an omitted prop
        // is LTR, which is exactly the sweep every consumer had before this
        // prop existed.
        view.writingDirection = value ?: AutoskeletonOverlayView.DIRECTION_LTR
    }

    override fun setDebugOverlay(view: AutoskeletonOverlayView, value: Boolean) {
        view.debugOverlay = value
    }

    companion object {
        const val REACT_CLASS = "AutoskeletonOverlayView"
    }
}
