@testable import Autoskeleton
import UIKit
import XCTest

/// Task 3.1 (tasks.md Phase 3) / plan.md §7.1: `AutoskeletonSensor` tests against
/// the shared synthetic view-hierarchy harness. 0.5 pt tolerance per plan.md §7.1.
/// Fixtures live in `test/fixtures/hierarchies/*.json`, expected wire output in
/// `test/fixtures/expected/*.json` — see `SyntheticHierarchyBuilder.swift`.
final class SyntheticHierarchyBuilderTests: XCTestCase {
    private let tolerance: CGFloat = 0.5

    private func assertShapes(
        _ actual: [AutoskeletonShapeInfo],
        matchExpected name: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws {
        let expected = try SyntheticHierarchyBuilder.loadExpected(named: name)
        XCTAssertEqual(actual.count, expected.shapes.count, "shape count mismatch for \(name)", file: file, line: line)
        for (index, pair) in zip(actual, expected.shapes).enumerated() {
            let (a, e) = pair
            XCTAssertEqual(a.x, e.x, accuracy: tolerance, "shape \(index) x mismatch", file: file, line: line)
            XCTAssertEqual(a.y, e.y, accuracy: tolerance, "shape \(index) y mismatch", file: file, line: line)
            XCTAssertEqual(a.w, e.w, accuracy: tolerance, "shape \(index) w mismatch", file: file, line: line)
            XCTAssertEqual(a.h, e.h, accuracy: tolerance, "shape \(index) h mismatch", file: file, line: line)
            XCTAssertEqual(a.r, e.r, accuracy: tolerance, "shape \(index) r mismatch", file: file, line: line)
            XCTAssertEqual(a.source.rawValue, e.source, "shape \(index) source mismatch", file: file, line: line)
        }
    }

    private func measure(fixtureNamed name: String, hints: AutoskeletonHintRegistry = AutoskeletonEmptyHintRegistry()) throws -> [AutoskeletonShapeInfo] {
        let fixture = try SyntheticHierarchyBuilder.loadFixture(named: name)
        let (_, root) = SyntheticHierarchyBuilder.build(fixture)
        let sensor = AutoskeletonSensor()
        let options = AutoskeletonSensorOptions(
            hints: hints,
            budgetMs: 2,
            maxShapes: 60,
            defaultRadius: 0,
            defaultLineHeight: 20,
            collectDebugSidecars: true
        )
        let result = try XCTUnwrap(sensor.measure(root: root, options: options))
        return result.shapes
    }

    // MARK: - Nested offsets

    func testNestedOffsets() throws {
        let shapes = try measure(fixtureNamed: "nested-offsets")
        try assertShapes(shapes, matchExpected: "nested-offsets")
    }

    // MARK: - Scrolled UIScrollView ancestor

    func testScrolledAncestorSubtractsContentOffset() throws {
        let shapes = try measure(fixtureNamed: "scrolled-ancestor")
        try assertShapes(shapes, matchExpected: "scrolled-ancestor")
    }

    // MARK: - Container rule, both branches

    func testContainerRuleLeavesWin() throws {
        let shapes = try measure(fixtureNamed: "container-rule-leaves-win")
        try assertShapes(shapes, matchExpected: "container-rule-leaves-win")
    }

    func testContainerRuleEmitsContainerWhenNoLeaves() throws {
        let shapes = try measure(fixtureNamed: "container-rule-no-leaves")
        try assertShapes(shapes, matchExpected: "container-rule-no-leaves")
    }

    /// The container rule's THIRD branch, previously ungated on every platform
    /// even though all three implement it: a container that reserves real
    /// layout space but paints nothing of its own, and holds no detectable
    /// leaf, contributes NOTHING.
    ///
    /// Stated as a decision rather than an accident (2026-08-30). It was
    /// challenged as a possible defect, because a subtree written the natural
    /// way — `{data !== null && <Image />}` — is empty while loading, and its
    /// sized wrapper looks exactly like the thing a skeleton should cover. It
    /// is not a defect: a non-transparent background is the ONLY observable
    /// difference between a box that is content and a box that is structure,
    /// and transparent sized boxes are how every React Native layout expresses
    /// spacers, flex fillers, safe-area padding and gap shims. Emitting a shape
    /// for them would paint grey blocks over the gaps in every loading screen.
    /// The consumer-side answer is an always-mounted opaque slot, documented in
    /// `docs/image-pipeline.md`.
    func testASizedButTransparentContainerWithNoLeavesEmitsNothing() throws {
        let shapes = try measure(fixtureNamed: "container-rule-sized-but-transparent")
        try assertShapes(shapes, matchExpected: "container-rule-sized-but-transparent")
    }

    // MARK: - Ignore subtree

    func testIgnoreSubtreeExcludesEntireSubtree() throws {
        struct IgnoringRegistry: AutoskeletonHintRegistry {
            func lines(for nodeId: String) -> Int? { nil }
            func radius(for nodeId: String) -> CGFloat? { nil }
            func isIgnored(_ nodeId: String) -> Bool { nodeId == "ignored-container" }
        }
        let shapes = try measure(fixtureNamed: "ignore-subtree", hints: IgnoringRegistry())
        try assertShapes(shapes, matchExpected: "ignore-subtree")
    }

    /// `<AutoSkeleton.Ignore>` bug fix (`src/native/Ignore.tsx`): the sentinel
    /// `accessibilityIdentifier` marker excludes the subtree DIRECTLY, with
    /// the DEFAULT `AutoskeletonEmptyHintRegistry` (no registry entry
    /// configured at all) — proving the marker channel is self-sufficient,
    /// exactly mirroring `testIgnoreSubtreeExcludesEntireSubtree` above but
    /// without any `AutoskeletonHintRegistry` override. Same expected output
    /// as `ignore-subtree`: only `visible-text` remains.
    func testIgnoreMarkerNativeIdExcludesSubtreeWithoutRegistryEntry() throws {
        let shapes = try measure(fixtureNamed: "ignore-marker-subtree")
        try assertShapes(shapes, matchExpected: "ignore-subtree")
    }

    // MARK: - Collapsed text synthesis (reuses AutoskeletonLines.swift, a port of lines.ts)

    func testCollapsedTextSynthesizesDefaultLineCount() throws {
        // h = 2 (fixture) is far below defaultLineHeight (20) with no `lines` hint,
        // so `autoskeletonDefaultLineCount` clamps to exactly 1 line — mirrors
        // `lines.test.ts`'s "rounds to at least one line" case.
        let shapes = try measure(fixtureNamed: "collapsed-text")
        XCTAssertEqual(shapes.count, 1)
        XCTAssertEqual(shapes[0].source, .syntheticLine)
        XCTAssertEqual(shapes[0].h, 20, accuracy: tolerance)
    }

    func testCollapsedTextHonorsLinesHint() throws {
        struct LinesHintRegistry: AutoskeletonHintRegistry {
            func lines(for nodeId: String) -> Int? {
                nodeId == "collapsed-text-1" ? 3 : nil
            }
            func radius(for nodeId: String) -> CGFloat? { nil }
            func isIgnored(_ nodeId: String) -> Bool { false }
        }
        let shapes = try measure(fixtureNamed: "collapsed-text", hints: LinesHintRegistry())
        XCTAssertEqual(shapes.count, 3)
        XCTAssertTrue(shapes.allSatisfy { $0.source == .syntheticLine })
        XCTAssertTrue(shapes.allSatisfy { $0.h == 20 })
        // stacks vertically at consecutive lineHeight offsets from the leaf's own y (10)
        XCTAssertEqual(shapes.map(\.y), [10, 30, 50])
        // every synthesized width stays within the 60%-85% band of the collapsed width (200)
        for shape in shapes {
            XCTAssertGreaterThanOrEqual(shape.w, 200 * 0.6 - 0.01)
            XCTAssertLessThanOrEqual(shape.w, 200 * 0.85 + 0.01)
        }
    }

    // MARK: - Transformed ancestor

    func testTransformedAncestorUsesRealConvert() throws {
        let shapes = try measure(fixtureNamed: "transformed-ancestor")
        try assertShapes(shapes, matchExpected: "transformed-ancestor")
    }

    // MARK: - RTL

    func testRTLGeometryPassesThroughUnchanged() throws {
        // RN's Yoga layout engine has already mirrored frames by the time a native
        // sensor runs (RTL mirroring is a Yoga concern, not a sensor concern) — this
        // fixture encodes an already-mirrored, trailing-aligned frame, and the test
        // proves the sensor reports it faithfully regardless of
        // `semanticContentAttribute`, rather than re-flipping or misinterpreting it.
        let shapes = try measure(fixtureNamed: "rtl")
        try assertShapes(shapes, matchExpected: "rtl")
    }

    // MARK: - REQ-NAV-1: rotation invalidation

    func testObserveInvokesCallbackOnOrientationChange() throws {
        let fixture = try SyntheticHierarchyBuilder.loadFixture(named: "nested-offsets")
        let (_, root) = SyntheticHierarchyBuilder.build(fixture)
        let sensor = AutoskeletonSensor()

        var received: [AutoskeletonInvalidationReason] = []
        let unsubscribe = sensor.observe(target: root) { reason in
            received.append(reason)
        }

        NotificationCenter.default.post(name: UIDevice.orientationDidChangeNotification, object: nil)
        XCTAssertEqual(received, [.orientation])

        NotificationCenter.default.post(name: UIContentSizeCategory.didChangeNotification, object: nil)
        XCTAssertEqual(received, [.orientation, .fontScale])

        unsubscribe()
        NotificationCenter.default.post(name: UIDevice.orientationDidChangeNotification, object: nil)
        XCTAssertEqual(received, [.orientation, .fontScale], "unsubscribe must stop further invalidation callbacks")
    }

    // MARK: - REQ-OBS-PROFILE-1: os_signpost intervals around traversal

    func testTraversalEmitsMatchedSignpostBeginAndEnd() throws {
        let fixture = try SyntheticHierarchyBuilder.loadFixture(named: "nested-offsets")
        let (_, root) = SyntheticHierarchyBuilder.build(fixture)
        let tracing = AutoskeletonRecordingTracing()
        let sensor = AutoskeletonSensor(tracing: tracing)

        _ = sensor.measure(root: root)

        XCTAssertEqual(tracing.events, [
            .begin("AutoskeletonTraversal"),
            .end("AutoskeletonTraversal"),
        ])
    }

    // MARK: - Budget / shape-cap degradation

    func testBudgetExceededTruncatesAndFlagsDegraded() throws {
        // A budgetMs of 0 guarantees the very first over-budget check trips
        // immediately, deterministically exercising the truncation path without
        // relying on real elapsed-time flakiness.
        let fixture = try SyntheticHierarchyBuilder.loadFixture(named: "nested-offsets")
        let (_, root) = SyntheticHierarchyBuilder.build(fixture)
        let sensor = AutoskeletonSensor()
        let options = AutoskeletonSensorOptions(
            hints: AutoskeletonEmptyHintRegistry(),
            budgetMs: 0,
            maxShapes: 60,
            defaultRadius: 0,
            defaultLineHeight: 20,
            collectDebugSidecars: true
        )
        let result = try XCTUnwrap(sensor.measure(root: root, options: options))
        XCTAssertTrue(result.degraded.contains(.budgetExceeded))
        XCTAssertEqual(result.shapes.count, 0)
    }

    func testShapeCapReachedTruncatesAndFlagsDegraded() throws {
        let fixture = try SyntheticHierarchyBuilder.loadFixture(named: "ignore-subtree")
        let (_, root) = SyntheticHierarchyBuilder.build(fixture)
        let sensor = AutoskeletonSensor()
        let options = AutoskeletonSensorOptions(
            hints: AutoskeletonEmptyHintRegistry(),
            budgetMs: 2,
            maxShapes: 1,
            defaultRadius: 0,
            defaultLineHeight: 20,
            collectDebugSidecars: true
        )
        let result = try XCTUnwrap(sensor.measure(root: root, options: options))
        XCTAssertTrue(result.degraded.contains(.shapeCapReached))
        XCTAssertEqual(result.shapes.count, 1)
    }

    // MARK: - measure() returns nil for an unlaid-out (zero-size) target

    func testMeasureReturnsNilForZeroSizeRoot() {
        let root = UIView(frame: .zero)
        let sensor = AutoskeletonSensor()
        XCTAssertNil(sensor.measure(root: root))
    }
}
