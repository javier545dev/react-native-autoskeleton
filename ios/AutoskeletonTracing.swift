import Foundation
import os

// Task 3.1/3.2 (tasks.md Phase 3) / spec.md REQ-OBS-PROFILE-1: `os_signpost`/
// `OSSignposter` intervals around traversal and draw. `OSSignposter` itself has no
// public way to assert "an interval was opened and closed with this name" from
// XCTest — Instruments capture is not scriptable in a unit test target — so this
// file defines a thin, injectable seam: production code always goes through
// `AutoskeletonTracing`, whose default implementation wraps a real `OSSignposter`;
// tests inject a recording double and assert on the recorded begin/end pairs
// instead. This is the standard pattern for testing signpost usage and is the
// "dedicated XCTest" plan.md §7.1 and §7.2 both call for.
protocol AutoskeletonTracing {
    /// Opens a named interval, returning an opaque token that must be passed back
    /// to `end(_:token:)` to close it.
    func begin(_ name: StaticString) -> Any
    func end(_ name: StaticString, token: Any)
}

/// Production implementation: a real `OSSignposter` on a dedicated `OSLog`
/// subsystem/category so traversal/draw intervals are distinguishable from system
/// noise in Instruments' Points of Interest track.
final class AutoskeletonSignpostTracing: AutoskeletonTracing {
    private let signposter: OSSignposter

    init(subsystem: String = "com.autoskeleton", category: String = "AutoskeletonSensor") {
        signposter = OSSignposter(logger: Logger(subsystem: subsystem, category: category))
    }

    func begin(_ name: StaticString) -> Any {
        let id = signposter.makeSignpostID()
        return (id, signposter.beginInterval(name, id: id))
    }

    func end(_ name: StaticString, token: Any) {
        guard let (id, state) = token as? (OSSignpostID, OSSignpostIntervalState) else { return }
        signposter.endInterval(name, state)
        _ = id
    }
}

/// Test double: records every begin/end call, in order, so a test can assert both
/// that an interval was opened AND that it was closed (not left dangling), and that
/// nesting/ordering matches REQ-OBS-PROFILE-2's same-thread begin/end discipline.
final class AutoskeletonRecordingTracing: AutoskeletonTracing {
    enum Event: Equatable {
        case begin(String)
        case end(String)
    }

    private(set) var events: [Event] = []
    private var nextToken = 0

    func begin(_ name: StaticString) -> Any {
        events.append(.begin("\(name)"))
        nextToken += 1
        return nextToken
    }

    func end(_ name: StaticString, token: Any) {
        events.append(.end("\(name)"))
    }
}
