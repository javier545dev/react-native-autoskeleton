import QuartzCore
import UIKit

// Task 3.3 (tasks.md Phase 3) / spec.md REQ-OBS-OVERLAY-1, brief §11: the iOS
// `debugOverlay` — outlines every detected shape with its index, source type, and a
// cache hit/miss badge, so a developer can answer "why was this node not detected"
// by looking for the SHAPE THAT ISN'T THERE (spec.md §2.3's "Debugging a missed
// node" scenario: the absence of an outline is itself the diagnostic signal).
//
// Dev-only, stripped from release: the entire type is wrapped in `#if DEBUG`, a
// true compile-time conditional in Swift (like the C preprocessor, not a runtime
// branch) — in a Release build this type literally does not exist in the compiled
// binary, verified by a dedicated release-configuration build + symbol-table check
// (not expressible as an XCTest case, since test schemes always build Debug; see
// the Phase 3 apply-progress notes for the exact `xcodebuild`/`nm` commands used).
enum AutoskeletonDebugOverlayAvailability {
    static var isAvailable: Bool {
        #if DEBUG
        return true
        #else
        return false
        #endif
    }
}

#if DEBUG
final class AutoskeletonDebugOverlay {
    struct Badge: Equatable {
        let index: Int
        let source: AutoskeletonShapeSource
        let cacheHit: Bool
        let radiusSource: AutoskeletonRadiusSource
    }

    private var outlineLayers: [CAShapeLayer] = []
    private var badgeLayers: [CATextLayer] = []
    private(set) var badges: [Badge] = []

    var shapeCount: Int { outlineLayers.count }

    /// Draws one outline + one badge label per shape (REQ-OBS-OVERLAY-1). Clears
    /// any previously mounted overlay first, so re-mounting on a data update never
    /// leaves stale outlines behind.
    func mount(on surface: UIView, shapes: [AutoskeletonShapeInfo], cacheHit: Bool) {
        clear()
        for (index, shape) in shapes.enumerated() {
            let rect = CGRect(x: shape.x, y: shape.y, width: shape.w, height: shape.h)
            let radius = min(shape.r, min(shape.w, shape.h) / 2)

            let outline = CAShapeLayer()
            outline.path = CGPath(
                roundedRect: rect,
                cornerWidth: max(radius, 0),
                cornerHeight: max(radius, 0),
                transform: nil
            )
            outline.strokeColor = UIColor.systemRed.cgColor
            outline.fillColor = UIColor.clear.cgColor
            outline.lineWidth = 1
            surface.layer.addSublayer(outline)
            outlineLayers.append(outline)

            let badge = CATextLayer()
            badge.string = "\(index) \(shape.source.rawValue) \(cacheHit ? "HIT" : "MISS")"
            badge.fontSize = 9
            badge.foregroundColor = UIColor.systemRed.cgColor
            badge.contentsScale = surface.window?.screen.scale ?? UIScreen.main.scale
            badge.frame = CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: 12)
            surface.layer.addSublayer(badge)
            badgeLayers.append(badge)

            badges.append(Badge(index: index, source: shape.source, cacheHit: cacheHit, radiusSource: shape.radiusSource))
        }
    }

    func clear() {
        outlineLayers.forEach { $0.removeFromSuperlayer() }
        badgeLayers.forEach { $0.removeFromSuperlayer() }
        outlineLayers.removeAll()
        badgeLayers.removeAll()
        badges.removeAll()
    }
}
#endif
