@testable import Autoskeleton
import UIKit
import XCTest

/// The hidden/transparent skip applies to descendants, never to the ROOT.
///
/// That skip exists to keep incidental UIKit subviews out of the traversal. The
/// root is not one of those: it is the exact tree JS asked the sensor to
/// measure, so refusing it because the caller made it transparent is the sensor
/// declining the job it was given.
///
/// It also makes "hide the wrapper while it is measured" a usable technique.
/// `AutoSkeleton.tsx` does not rely on it — it covers the content with an
/// opaque placeholder instead — but before this, hiding the wrapper silently
/// produced an empty snapshot, because the traversal starts at that same
/// wrapper and refused it.
///
/// Web already behaves this way (`dom-sensor.ts` checks opacity per LEAF and
/// records that "an `opacity: 0` CONTAINER still has its descendants shaped"),
/// so this closes a platform divergence. `AutoskeletonSensorTest.kt` carries
/// the same two cases.
final class AutoskeletonSensorRootVisibilityTests: XCTestCase {
    private func options() -> AutoskeletonSensorOptions {
        AutoskeletonSensorOptions(
            hints: AutoskeletonEmptyHintRegistry(),
            budgetMs: 1000,
            maxShapes: 60,
            defaultRadius: 0,
            defaultLineHeight: 20,
            collectDebugSidecars: true
        )
    }

    /// `root` is transparent, `child` is paintable.
    private func makeTree() -> (root: UIView, child: UIView) {
        let bounds = CGRect(x: 0, y: 0, width: 200, height: 200)
        let root = UIView(frame: bounds)
        let child = UIView(frame: bounds)
        child.backgroundColor = .red
        root.addSubview(child)
        return (root, child)
    }

    func testATransparentRootIsStillMeasured() throws {
        let (root, _) = makeTree()
        root.alpha = 0
        let result = try XCTUnwrap(AutoskeletonSensor().measure(root: root, options: options()))
        XCTAssertEqual(result.shapes.count, 1)
    }

    func testAHiddenRootIsStillMeasured() throws {
        let (root, _) = makeTree()
        root.isHidden = true
        let result = try XCTUnwrap(AutoskeletonSensor().measure(root: root, options: options()))
        XCTAssertEqual(result.shapes.count, 1)
    }

    /// Anti-vacuity, and the other half of the rule: the exemption is for the
    /// root ONLY. A transparent DESCENDANT contributes no visible pixels and
    /// must still contribute no shape, or the skip would be gone entirely.
    func testATransparentDescendantIsStillSkipped() throws {
        let (root, child) = makeTree()
        child.alpha = 0
        let result = try XCTUnwrap(AutoskeletonSensor().measure(root: root, options: options()))
        XCTAssertEqual(result.shapes.count, 0)
    }
}
