@testable import Autoskeleton
import UIKit
import XCTest

/// The unbounded-recursion defect, and its fix, on iOS.
///
/// `AutoskeletonSensor.traverse` recursed with no depth bound at all, so a
/// deep enough view tree overflowed the call stack before any other limit
/// could stop it. `overBudget()` cannot stand in: it is TIME-based and only
/// ever stops FUTURE recursive calls, and a tree deep enough to blow the
/// stack does so in far less than `budgetMs` of wall-clock time. The web
/// sensor grew `MAX_TRAVERSAL_DEPTH` for exactly this (a ~3000-level nested
/// tree crashed the renderer); both native sensors carried the same unbounded
/// recursion and neither carried the bound. Kotlin's twin of this suite is
/// `AutoskeletonSensorTest.depthCapReachedTruncatesAndFlagsDegraded`.
final class AutoskeletonSensorDepthCapTests: XCTestCase {

    /// A singly-nested chain `depth` levels below the root, where ONLY the
    /// deepest view is paintable. Built programmatically rather than as a JSON
    /// fixture: the interesting depths are in the hundreds, and a 400-level
    /// fixture file would be unreadable and unmaintainable.
    private func buildDeepChain(depth: Int) -> UIView {
        let bounds = CGRect(x: 0, y: 0, width: 200, height: 200)
        let root = UIView(frame: bounds)
        var current = root
        for _ in 0..<depth {
            let child = UIView(frame: bounds)
            current.addSubview(child)
            current = child
        }
        current.backgroundColor = .red
        return root
    }

    private func options() -> AutoskeletonSensorOptions {
        // A generous budget on purpose: this suite is about the depth bound,
        // and a time budget tripping first would make it pass for the wrong
        // reason.
        AutoskeletonSensorOptions(
            hints: AutoskeletonEmptyHintRegistry(),
            budgetMs: 1000,
            maxShapes: 60,
            defaultRadius: 0,
            defaultLineHeight: 20,
            collectDebugSidecars: true
        )
    }

    func testDepthCapReachedTruncatesAndFlagsDegraded() throws {
        let sensor = AutoskeletonSensor()
        let result = try XCTUnwrap(sensor.measure(root: buildDeepChain(depth: 400), options: options()))
        XCTAssertTrue(
            result.degraded.contains(.depthCapReached),
            "expected .depthCapReached, got \(result.degraded)"
        )
        // The one paintable view sits BELOW the cap, so truncation must drop it.
        XCTAssertEqual(result.shapes.count, 0)
    }

    /// Anti-vacuity for the test above: without this, a cap that fired on
    /// every traversal — or a `buildDeepChain` that silently produced nothing
    /// measurable — would still pass it. A chain well under the cap must
    /// traverse to the bottom, flag nothing, and yield its one shape.
    func testDepthUnderCapTraversesFullyAndFlagsNothing() throws {
        let sensor = AutoskeletonSensor()
        let result = try XCTUnwrap(sensor.measure(root: buildDeepChain(depth: 50), options: options()))
        XCTAssertFalse(
            result.degraded.contains(.depthCapReached),
            "a 50-deep chain must not trip the depth cap, got \(result.degraded)"
        )
        XCTAssertEqual(result.shapes.count, 1)
    }
}
