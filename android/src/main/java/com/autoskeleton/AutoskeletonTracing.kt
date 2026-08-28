package com.autoskeleton

import android.os.Trace

// Task 4.1 (tasks.md Phase 4) / spec.md REQ-OBS-PROFILE-1/2: `Trace.beginSection`/
// `endSection` intervals around traversal and draw. Same injectable-seam pattern as
// iOS's `AutoskeletonTracing.swift`: `Trace.beginSection`/`endSection` are
// fire-and-forget system calls with nothing to assert on directly from a test (and
// Robolectric's shadow does not expose recorded section names for inspection), so
// production code depends on this interface and tests inject a recording double
// instead.
//
// REQ-OBS-PROFILE-2 (name <= 127 chars, same-thread begin/end nesting) is enforced
// by `AutoskeletonSystemTracing.begin` itself (a hard `require`) rather than left as
// a documentation-only constraint — asserted directly by a dedicated test.
interface AutoskeletonTracing {
    fun begin(name: String)
    fun end(name: String)
}

const val AUTOSKELETON_MAX_TRACE_SECTION_NAME_LENGTH = 127

/** Production implementation: real `Trace.beginSection`/`endSection` on the calling
 *  thread — same-thread nesting (REQ-OBS-PROFILE-2) holds by construction since
 *  Android's `Trace` section stack is itself thread-local. */
class AutoskeletonSystemTracing : AutoskeletonTracing {
    override fun begin(name: String) {
        require(name.length <= AUTOSKELETON_MAX_TRACE_SECTION_NAME_LENGTH) {
            "Trace section name exceeds the $AUTOSKELETON_MAX_TRACE_SECTION_NAME_LENGTH-character " +
                "limit (REQ-OBS-PROFILE-2): $name"
        }
        Trace.beginSection(name)
    }

    override fun end(name: String) {
        Trace.endSection()
    }
}

/** Test double: records every begin/end call, in order, so a test can assert both
 *  that an interval was opened AND that it was closed (not left dangling), and that
 *  nesting/ordering matches REQ-OBS-PROFILE-2's same-thread begin/end discipline. */
class AutoskeletonRecordingTracing : AutoskeletonTracing {
    sealed class Event {
        data class Begin(val name: String) : Event()
        data class End(val name: String) : Event()
    }

    val events = mutableListOf<Event>()

    override fun begin(name: String) {
        events.add(Event.Begin(name))
    }

    override fun end(name: String) {
        events.add(Event.End(name))
    }
}
