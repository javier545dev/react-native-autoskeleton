import XCTest

/// The RTL half of the paint gate, and the reason it exists as its own class:
/// until this file, NOT ONE on-device gate ran right-to-left. That is how a
/// synthesized text line stayed anchored to the wrong edge without anything
/// going red.
///
/// WHAT THE DEFECT LOOKED LIKE. A synthesized line is deliberately narrower
/// than its frame (`MAX_WIDTH_RATIO` = 0.85 for a single line), so it has to
/// hang from the LEADING edge. It hung from `x` unconditionally, which is
/// correct in LTR and wrong in RTL: the placeholder sat over the blank half of
/// the frame while the live glyphs — flush right — stayed in the clear.
/// Measured on the iPhone 17 Pro simulator before the fix, real pixels of 1206:
///
///     frame of the `<Text>` : 402 → 1134
///     synthesized skeleton   : 402 → 1023   (622px, the 85% single-line ratio)
///     glyphs left exposed    : 1024 → ~1132 (~110px of live text, in the clear)
///
/// After the fix the skeleton is 512 → 1133 — the exact mirror.
///
/// WHY THE FIXTURE HAD TO CHANGE FIRST. This gate is only meaningful because
/// `App.tsx` pins `textAlign: 'start'` on the text blocks. With `textAlign`
/// left at its default, React Native's `RCTResolveTextAlignment` lets
/// `Natural` through unresolved — and an omitted `textAlign` never reaches
/// that function at all — so iOS keeps Latin glyphs on the LEFT under RTL and
/// a left-anchored skeleton covers them by coincidence. A gate written against
/// that fixture PASSES with the defect in place. It was written, it did pass,
/// and that is why the fixture is the way it is.
final class PaintGateRtlUITests: XCTestCase {
    typealias RGB = (r: Int, g: Int, b: Int)

    private static let mountTimeout: TimeInterval = 180
    private static let colorTolerance = 16

    /// `native/AutoSkeleton.tsx`'s `DEFAULT_THEME`.
    private static let skeletonBase: RGB = (0xE2, 0xE2, 0xE2)
    private static let skeletonHighlight: RGB = (0xF5, 0xF5, 0xF5)

    /// `PAINT_GATE_FIXTURE.colors` — App.tsx's header says not to change one
    /// without the other.
    private static let fillText: RGB = (0x10, 0x10, 0x10)
    private static let fillTextRtl: RGB = (0x8B, 0x00, 0x00)

    private static let labelToggle = "paint-gate-toggle"
    private static let labelText = "paint-gate-text"
    private static let labelTextRtl = "paint-gate-text-rtl"

    /// ADR-16 defaults: handoffTimeoutMs=250, handoffFadeMs=120. Waiting past
    /// both before sampling is real production timing, not an arbitrary sleep.
    private static let handoffSettle: TimeInterval = 0.6

    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = makeApp()
        app.launch()
    }

    override func tearDownWithError() throws {
        app?.terminate()
    }

    /// `-RCTI18nUtil_forceRTL YES` is RN's own storage, read by `RCTI18nUtil`
    /// straight out of `NSUserDefaults` — a launch argument of that shape
    /// becomes a volatile default for the launched process only. That matters:
    /// unlike the JS `I18nManager.forceRTL()`, it leaves NOTHING behind on the
    /// simulator, so this gate cannot flip a later test (or the next manual
    /// run) into RTL the way a persisted flag would.
    private func makeApp() -> XCUIApplication {
        let launched = XCUIApplication()
        launched.launchArguments = ["-RCTI18nUtil_forceRTL", "YES"]
        return launched
    }

    func testSynthesizedTextLineHangsFromTheTrailingEdgeUnderRtl() {
        waitForMount()

        // The frames have to be read in the LOADED state: REQ-A11Y-1 correctly
        // hides the real content from the accessibility hierarchy while the
        // skeleton is painted, and XCUITest sees exactly that hierarchy. Same
        // reasoning, and the same relaunch, as `PaintGateUITests`.
        element(Self.labelToggle).tap()
        Thread.sleep(forTimeInterval: Self.handoffSettle)

        let rtlFrame = element(Self.labelTextRtl).frame
        let ltrFrame = element(Self.labelText).frame
        XCTAssertFalse(
            rtlFrame.isEmpty || ltrFrame.isEmpty,
            "FIXTURE FAILURE: could not read the text blocks' frames in the loaded state."
        )

        // Back to a real cold first load, still under RTL.
        app.terminate()
        app = makeApp()
        app.launch()
        waitForMount()
        Thread.sleep(forTimeInterval: Self.handoffSettle)

        let image = XCUIScreen.main.screenshot().image
        assertUncoveredGapIsLeading(image, frame: rtlFrame, fill: Self.fillTextRtl, label: Self.labelTextRtl)
        assertUncoveredGapIsLeading(image, frame: ltrFrame, fill: Self.fillText, label: Self.labelText)
    }

    /// Samples the block's centre row and asserts the UNCOVERED region — the
    /// part still showing the block's own fill — sits on the LEFT, which is
    /// where a right-anchored line leaves it.
    ///
    /// THE ORACLE IS THE FILL, NOT THE SKELETON RAMP, and that is not a
    /// stylistic choice. The Android sibling of this gate was first written
    /// against the ramp and was VACUOUS: the fixture's glyphs are `#ffffff`,
    /// and the ramp check spans `#E2E2E2`..`#F5F5F5` inflated by ±16, which
    /// reaches 255 — so every white glyph counted as "skeleton painted here".
    /// With the anchor deliberately reverted that gate still passed. The
    /// block's fill is saturated and far from both the ramp and white, so
    /// "fill is visible here" reads unambiguously as "not covered".
    ///
    /// Counting fill samples per half — rather than locating edges — also
    /// survives the glyphs sitting inside the uncovered gap: they punch holes
    /// in the fill run but cannot move which half its bulk is in.
    private func assertUncoveredGapIsLeading(
        _ image: UIImage,
        frame: CGRect,
        fill: RGB,
        label: String
    ) {
        let y = frame.midY
        let samples = 120
        var fillLeading = 0
        var fillTrailing = 0
        var rampSamples = 0
        let middle = frame.midX

        for i in 0..<samples {
            let t = CGFloat(i) / CGFloat(samples - 1)
            let x = frame.minX + t * (frame.width - 1)
            guard let pixel = pixelColor(image, x: x, y: y) else { continue }
            if colorsClose(pixel, fill) {
                if x < middle { fillLeading += 1 } else { fillTrailing += 1 }
            } else if colorInRamp(pixel, from: Self.skeletonBase, to: Self.skeletonHighlight) {
                rampSamples += 1
            }
        }

        // Anti-vacuity: with no skeleton on screen at all, "the fill is mostly
        // on the left" could be satisfied by an empty or half-drawn frame.
        XCTAssertGreaterThan(
            rampSamples, samples / 4,
            "FIXTURE FAILURE (not this gate's assertion): only \(rampSamples)/\(samples) samples " +
                "across \"\(label)\" landed in the skeleton ramp. Either the skeleton never " +
                "painted or the fixture colours drifted from App.tsx — either way there is " +
                "nothing here to judge."
        )

        XCTAssertGreaterThan(
            fillLeading, fillTrailing,
            "RTL ANCHOR REGRESSION on \"\(label)\": the block's own fill is still visible in " +
                "\(fillTrailing) of \(samples) samples in the TRAILING half against only " +
                "\(fillLeading) in the leading half. Under RTL the synthesized line must hang " +
                "from the trailing (right) edge, so the uncovered gap belongs on the LEFT. A gap " +
                "on the right is the original defect: the line kept its LTR origin while the " +
                "glyphs moved to the right edge, leaving live text in the open beside a " +
                "placeholder standing over blank space."
        )
    }

    // MARK: - Plumbing

    private func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func waitForMount() {
        let mounted = element(Self.labelToggle).waitForExistence(timeout: Self.mountTimeout)
        XCTAssertTrue(
            mounted,
            "FIXTURE FAILURE (not the gate's own assertion): PaintGateScreen never mounted " +
                "within \(Int(Self.mountTimeout))s — the JS bundle, Metro connection, or App.tsx " +
                "fixture itself is broken, not the anchor."
        )
    }

    private func pixelColor(_ image: UIImage, x: CGFloat, y: CGFloat) -> RGB? {
        guard let cgImage = image.cgImage,
              let data = cgImage.dataProvider?.data,
              let bytes = CFDataGetBytePtr(data)
        else { return nil }
        let scale = image.scale
        let px = Int((x * scale).rounded())
        let py = Int((y * scale).rounded())
        guard px >= 0, py >= 0, px < cgImage.width, py < cgImage.height else { return nil }
        let bytesPerPixel = max(cgImage.bitsPerPixel / 8, 1)
        let offset = py * cgImage.bytesPerRow + px * bytesPerPixel
        guard offset + 2 < CFDataGetLength(data) else { return nil }
        return (Int(bytes[offset]), Int(bytes[offset + 1]), Int(bytes[offset + 2]))
    }

    private func colorsClose(_ a: RGB, _ b: RGB, tolerance: Int = colorTolerance) -> Bool {
        abs(a.r - b.r) <= tolerance && abs(a.g - b.g) <= tolerance && abs(a.b - b.b) <= tolerance
    }

    private func colorInRamp(_ pixel: RGB, from: RGB, to: RGB, tolerance: Int = colorTolerance) -> Bool {
        func inRange(_ value: Int, _ a: Int, _ b: Int) -> Bool {
            value >= min(a, b) - tolerance && value <= max(a, b) + tolerance
        }
        return inRange(pixel.r, from.r, to.r)
            && inRange(pixel.g, from.g, to.g)
            && inRange(pixel.b, from.b, to.b)
    }
}
