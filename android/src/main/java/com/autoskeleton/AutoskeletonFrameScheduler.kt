package com.autoskeleton

import android.view.Choreographer

// Task 4.4 (tasks.md Phase 4) / brief §4 "Renderers > Default": Android's tier-1
// shimmer invalidates via `postInvalidateOnAnimation`, driven by `Choreographer` —
// the mechanism itself has nothing to assert on directly from a test (a real
// `Choreographer` frame callback fires on the real display vsync, not
// deterministically under Robolectric), so production code depends on this
// injectable seam — same pattern as `AutoskeletonTracing` — and tests inject a
// recording double that ticks deterministically instead.
interface AutoskeletonFrameScheduler {
    /** Schedules `callback` to run on the next frame. Implementations MUST call it
     *  at most once per `postFrameCallback` call — the caller re-schedules the next
     *  frame itself if it wants to keep animating. */
    fun postFrameCallback(callback: () -> Unit)

    /** Cancels a pending callback, if any. */
    fun cancel()
}

/** Production implementation: a real `Choreographer` frame callback. */
class AutoskeletonChoreographerFrameScheduler : AutoskeletonFrameScheduler {
    private val choreographer = Choreographer.getInstance()
    private var pending: Choreographer.FrameCallback? = null

    override fun postFrameCallback(callback: () -> Unit) {
        val frameCallback = Choreographer.FrameCallback {
            pending = null
            callback()
        }
        pending = frameCallback
        choreographer.postFrameCallback(frameCallback)
    }

    override fun cancel() {
        pending?.let { choreographer.removeFrameCallback(it) }
        pending = null
    }
}

/** Test double: records the pending callback instead of scheduling it against a
 *  real display vsync. `tick()` runs it deterministically, exactly once, mirroring
 *  a single Choreographer frame firing. */
class AutoskeletonRecordingFrameScheduler : AutoskeletonFrameScheduler {
    var postCount = 0
        private set
    private var pendingCallback: (() -> Unit)? = null

    override fun postFrameCallback(callback: () -> Unit) {
        postCount += 1
        pendingCallback = callback
    }

    override fun cancel() {
        pendingCallback = null
    }

    /** Fires the pending callback (if any), simulating one Choreographer frame. */
    fun tick() {
        val callback = pendingCallback
        pendingCallback = null
        callback?.invoke()
    }
}
