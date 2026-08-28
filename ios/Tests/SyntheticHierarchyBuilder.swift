@testable import Autoskeleton
import Foundation
import UIKit

/// Task 3.1 (tasks.md Phase 3) / plan.md §7.1: test-target-only harness that
/// instantiates real Fabric component view classes (`RCTParagraphComponentView`,
/// `RCTImageComponentView`, `RCTTextInputComponentView`, plain
/// `RCTViewComponentView` containers), attaches them to a fixed-size `UIWindow`,
/// sets explicit frames, and calls `layoutIfNeeded()` so `convert(rect:to:)`
/// operates on genuine laid-out geometry rather than mocked values.
///
/// Fixtures are shared, per-plan.md §7.1's golden-parity mechanism, with the
/// Android (task 4.1) and web (task 2.1) sensor harnesses — see
/// `test/fixtures/hierarchies/README.md` for the JSON schema this builder parses.
///
/// **Why direct `init(frame:)` construction is safe here, stated explicitly**: the
/// three Fabric leaf classes and `RCTViewComponentView` are plain `UIView`
/// subclasses with no custom *public* designated initializer that requires a
/// Fabric `Props`/`ShadowNode`/`State` object to construct — verified from
/// `React.framework`'s public headers (`RCTViewComponentView.h`,
/// `RCTParagraphComponentView.h`, `RCTImageComponentView.h`,
/// `RCTTextInputComponentView.h`), all of which expose only inherited `UIView`
/// initializers. This harness therefore sets the same public properties a real
/// Fabric mount would apply (`frame`, `backgroundColor`, `layer.cornerRadius`,
/// `accessibilityIdentifier`, `transform`, `semanticContentAttribute`) directly,
/// without needing a live `FabricUIManager`. **What this deliberately does NOT
/// attempt**: `RCTParagraphComponentView.attributedText` is read-only and backed by
/// Fabric's C++ `ParagraphState`, which this harness cannot populate — see
/// `AutoskeletonSensor.swift`'s collapsed-text design note for how the sensor
/// handles that honestly (geometric collapse detection, not content inspection).
enum SyntheticHierarchyBuilder {
    struct Fixture: Decodable {
        let `class`: String
        let frame: FixtureFrame
        let backgroundColor: String?
        let cornerRadius: CGFloat?
        let nativeID: String?
        let contentOffset: FixtureFrame.Point?
        let contentSize: FixtureFrame.Point?
        let transform: FixtureTransform?
        let semanticContentAttribute: String?
        let children: [Fixture]?
    }

    struct FixtureFrame: Decodable {
        struct Point: Decodable {
            let x: CGFloat
            let y: CGFloat
        }
        let x: CGFloat
        let y: CGFloat
        let w: CGFloat
        let h: CGFloat

        var rect: CGRect { CGRect(x: x, y: y, width: w, height: h) }
    }

    struct FixtureTransform: Decodable {
        let scale: CGFloat?
        let translateX: CGFloat?
        let translateY: CGFloat?
        let rotationDegrees: CGFloat?
    }

    /// Repo-root-relative path resolution. Works because the pod is consumed via a
    /// symlinked `:path` dependency (see `examples/bare-rn/ios/Podfile`), so this
    /// compiled test binary runs against the real repo checkout on the Simulator
    /// host filesystem — the Simulator process has ordinary access to the host Mac's
    /// filesystem, unlike a real device. Real-device fixture loading would need
    /// bundled test resources instead; out of scope here (this suite only targets
    /// the Simulator, per tasks.md's `xcodebuild test` runtime harness).
    static var packageRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // SyntheticHierarchyBuilder.swift -> ios/Tests/
            .deletingLastPathComponent() // ios/Tests/ -> ios/
            .deletingLastPathComponent() // ios/ -> repo root
    }

    static var fixturesDirectory: URL {
        packageRoot.appendingPathComponent("test/fixtures/hierarchies")
    }

    static var expectedDirectory: URL {
        packageRoot.appendingPathComponent("test/fixtures/expected")
    }

    static func loadFixture(named name: String) throws -> Fixture {
        let url = fixturesDirectory.appendingPathComponent("\(name).json")
        let data = try Data(contentsOf: url)
        return try JSONDecoder().decode(Fixture.self, from: data)
    }

    struct ExpectedShape: Decodable {
        let x: CGFloat
        let y: CGFloat
        let w: CGFloat
        let h: CGFloat
        let r: CGFloat
        let source: String
    }

    struct ExpectedOutput: Decodable {
        let shapes: [ExpectedShape]
    }

    static func loadExpected(named name: String) throws -> ExpectedOutput {
        let url = expectedDirectory.appendingPathComponent("\(name).json")
        let data = try Data(contentsOf: url)
        return try JSONDecoder().decode(ExpectedOutput.self, from: data)
    }

    /// Builds the fixture into a real, laid-out view hierarchy attached to a fixed
    /// `UIWindow`, and returns the root view (the window's sole subview) ready for
    /// `AutoskeletonSensor.measure(root:)`.
    @discardableResult
    static func build(_ fixture: Fixture, windowSize: CGSize = CGSize(width: 400, height: 800)) -> (window: UIWindow, root: UIView) {
        let window = UIWindow(frame: CGRect(origin: .zero, size: windowSize))
        window.isHidden = false
        let root = makeView(fixture)
        window.addSubview(root)
        window.layoutIfNeeded()
        root.layoutIfNeeded()
        layoutSubtree(root, fixture: fixture)
        window.layoutIfNeeded()
        return (window, root)
    }

    private static func makeView(_ fixture: Fixture) -> UIView {
        let view: UIView
        switch fixture.class {
        case "text":
            view = AutoskeletonReactViewClassifier.makeParagraphView(withFrame: fixture.frame.rect)
        case "image":
            view = AutoskeletonReactViewClassifier.makeImageView(withFrame: fixture.frame.rect)
        case "input":
            view = AutoskeletonReactViewClassifier.makeTextInputView(withFrame: fixture.frame.rect)
        case "scroll":
            let scrollView = UIScrollView(frame: fixture.frame.rect)
            scrollView.showsVerticalScrollIndicator = false
            scrollView.showsHorizontalScrollIndicator = false
            // Disables automatic safe-area-driven content-inset/offset adjustment,
            // which otherwise silently overrides an explicitly assigned
            // `contentOffset` once the view resolves its safe area after being
            // added to a window — this fixture is testing pure offset-subtraction
            // geometry, not safe-area interaction.
            scrollView.contentInsetAdjustmentBehavior = .never
            // `contentSize` MUST be set before `contentOffset`: UIScrollView clamps
            // `contentOffset` to the scrollable range implied by `contentSize` minus
            // `bounds.size`, and with the default zero `contentSize` any non-zero
            // offset is silently clamped back to (0, 0) — exactly the bug that made
            // this fixture initially fail with the offset appearing to do nothing.
            if let size = fixture.contentSize {
                scrollView.contentSize = CGSize(width: size.x, height: size.y)
            }
            if let offset = fixture.contentOffset {
                scrollView.contentOffset = CGPoint(x: offset.x, y: offset.y)
            }
            view = scrollView
        default:
            view = AutoskeletonReactViewClassifier.makeContainerView(withFrame: fixture.frame.rect)
        }

        view.frame = fixture.frame.rect
        if let hex = fixture.backgroundColor {
            view.backgroundColor = UIColor(autoskeletonHex: hex)
        }
        if let radius = fixture.cornerRadius {
            view.layer.cornerRadius = radius
        }
        if let nativeID = fixture.nativeID {
            view.accessibilityIdentifier = nativeID
        }
        if let transform = fixture.transform {
            var t = CGAffineTransform.identity
            if let scale = transform.scale {
                t = t.scaledBy(x: scale, y: scale)
            }
            if let degrees = transform.rotationDegrees {
                t = t.rotated(by: degrees * .pi / 180)
            }
            t = t.translatedBy(
                x: transform.translateX ?? 0,
                y: transform.translateY ?? 0
            )
            view.transform = t
        }
        if let semantic = fixture.semanticContentAttribute {
            switch semantic {
            case "forceRightToLeft":
                view.semanticContentAttribute = .forceRightToLeft
            case "forceLeftToRight":
                view.semanticContentAttribute = .forceLeftToRight
            default:
                break
            }
        }

        for child in fixture.children ?? [] {
            let childView = makeView(child)
            view.addSubview(childView)
        }

        return view
    }

    private static func layoutSubtree(_ view: UIView, fixture: Fixture) {
        view.frame = fixture.frame.rect
        for (childView, childFixture) in zip(view.subviews, fixture.children ?? []) {
            layoutSubtree(childView, fixture: childFixture)
        }
        view.layoutIfNeeded()
    }
}

private extension UIColor {
    /// Minimal `#RRGGBB` / `#RRGGBBAA` parser — the fixture format only needs solid
    /// colors, never a full CSS color grammar.
    convenience init(autoskeletonHex hex: String) {
        var s = hex
        if s.hasPrefix("#") {
            s.removeFirst()
        }
        var value: UInt64 = 0
        Scanner(string: s).scanHexInt64(&value)
        let hasAlpha = s.count == 8
        let r, g, b, a: CGFloat
        if hasAlpha {
            r = CGFloat((value & 0xFF00_0000) >> 24) / 255
            g = CGFloat((value & 0x00FF_0000) >> 16) / 255
            b = CGFloat((value & 0x0000_FF00) >> 8) / 255
            a = CGFloat(value & 0x0000_00FF) / 255
        } else {
            r = CGFloat((value & 0xFF0000) >> 16) / 255
            g = CGFloat((value & 0x00FF00) >> 8) / 255
            b = CGFloat(value & 0x0000FF) / 255
            a = 1
        }
        self.init(red: r, green: g, blue: b, alpha: a)
    }
}
