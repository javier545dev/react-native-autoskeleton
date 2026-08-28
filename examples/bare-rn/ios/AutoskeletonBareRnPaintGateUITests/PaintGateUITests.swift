import XCTest

/// Step 2b (`sdd/auto-skeleton-v1` visual-paint-gate remediation) — the iOS
/// analog of `PaintGateInstrumentedTest.kt`
/// (`examples/bare-rn/android/app/src/androidTest/java/com/autoskeletonbarern/PaintGateInstrumentedTest.kt`).
/// Built BEFORE the iOS `RCTViewComponentView` overlay subclass exists, on
/// purpose — this is the visual gate that proves hand-written Fabric ObjC++
/// interop actually paints real pixels, and it must be able to fail for the
/// right reason ("nothing painted") before that view exists at all.
///
/// **Why this needed a real XCUITest target, not the pod's `test_spec`
/// `Autoskeleton-Unit-Tests` bundle**: that bundle is a bare XCTest process
/// with no `TEST_HOST` / `requires_app_host` / `app_host_name` (verified: the
/// pod's `Tests` test_spec declares none of them), so it never has a
/// `UIApplication`, can never launch the real app, and can never load a real
/// JS bundle. CocoaPods' `app_host_name` mechanism (`test_spec.app_host_name`
/// + `spec.app_spec`) hosts a test bundle inside a MINIMAL app the POD itself
/// builds — not the real `AutoskeletonBareRn` app with Metro connectivity and
/// the real `PaintGateScreen` fixture — so it cannot satisfy this gate either.
/// A genuine `com.apple.product-type.bundle.ui-testing` target that launches
/// the real `.app` as an external process via `XCUIApplication` is the only
/// mechanism that gets a real `UIApplication`, a real JS bundle from Metro,
/// and real GPU-composited pixels to sample.
///
/// What this test actually exercises, end to end, on a real Simulator:
/// 1. Launches the REAL `AutoskeletonBareRn` app, which boots the real JS
///    bundle from Metro and mounts the real `PaintGateScreen`
///    (`examples/bare-rn/App.tsx`) — the SAME fixture the Android gate uses,
///    imported from the published `autoskeleton` package via the real
///    `getShapes` Turbo Module bridge and the real `AutoskeletonSensor`.
/// 2. Locates each fixture region by its real `testID` (`accessibilityIdentifier`
///    on iOS) via `XCUIApplication.descendants(matching:)` — never by guessed
///    coordinates, so a layout change alone can never cause a false RED.
/// 3. Rasterizes the REAL, currently-displayed frame with
///    `XCUIScreen.main.screenshot()` — a real Simulator screen capture, not
///    `UIView.drawHierarchy`, which can silently miss content the render
///    server composited but the view hierarchy alone would not reflect —
///    then reads real RGB pixels back from the resulting `CGImage`.
///
/// Colour-ramp semantics mirror the Android gate exactly (same fix, same
/// reasoning): the production draw pass paints an animated gradient between
/// `baseColor` and `highlightColor`, so "a skeleton painted here" means "this
/// pixel is somewhere in the shimmer ramp", never "at this exact phase".
final class PaintGateUITests: XCTestCase {
    // native/AutoSkeleton.tsx's DEFAULT_THEME.baseColor/highlightColor — not
    // redefined anywhere else, deliberately hardcoded here (mirrors the
    // Android gate) so this test fails loudly rather than silently if the
    // production theme default ever changes.
    private static let skeletonBaseColor: RGB = (0xE2, 0xE2, 0xE2)
    private static let skeletonHighlightColor: RGB = (0xF5, 0xF5, 0xF5)

    // examples/bare-rn/App.tsx PAINT_GATE_FIXTURE.colors — real, opaque,
    // mutually distinct from the skeleton ramp and from each other.
    private static let contentImageColor: RGB = (0x00, 0x00, 0xFF)
    private static let contentCardColor: RGB = (0x00, 0xA6, 0x51)

    // Per-channel slack for Simulator screenshot compositor/scaling noise —
    // identical value and identical rationale to the Android gate's
    // `COLOR_TOLERANCE`.
    private static let colorTolerance = 16

    private static let mountTimeout: TimeInterval = 20
    // Task 5.8 (tasks.md Phase 5, task 5.7 follow-up): before the iOS
    // `AutoskeletonOverlayView` existed, `waitForMount()`'s single
    // `paint-gate-image` existence check was sufficient — there was no
    // overlay to race against, so the gate was deterministically RED for
    // the right reason regardless of sampling timing. Now that a real
    // overlay exists, it mounts on a LATER React render pass than the
    // content children: content mounts unconditionally on the FIRST pass,
    // while `<AutoSkeleton>`'s overlay only appears once its async native
    // `getShapes` round-trip resolves and `showSkeleton && snapshot` become
    // true (`src/native/AutoSkeleton.tsx`). Sampling exactly once right
    // after `waitForMount()` returns races that round-trip — confirmed
    // empirically this session: a single-shot sample flipped between
    // passing and failing across otherwise-identical runs (4/4 consecutive
    // failures once the JS/native bridge round-trip legitimately started
    // taking slightly longer than the single sample's implicit zero-wait).
    // `pollUntilPixel` below polls for up to this timeout instead of
    // sampling once, exactly the same "wait for the real condition, don't
    // guess a sleep duration" discipline `waitForMount` itself already
    // uses — never a widened colour tolerance, which would be the wrong
    // kind of fix.
    private static let overlaySettleTimeout: TimeInterval = 5
    private static let pollInterval: TimeInterval = 0.1
    // ADR-16 defaults (`core/handoff.ts`): handoffTimeoutMs=250,
    // handoffFadeMs=120. Waiting past both, plus slack, before sampling
    // post-toggle pixels is real production timing, not an arbitrary sleep.
    private static let handoffSettleSeconds: TimeInterval = 0.6

    private static let labelToggle = "paint-gate-toggle"
    private static let labelImage = "paint-gate-image"
    private static let labelCard = "paint-gate-rounded-card"

    typealias RGB = (r: Int, g: Int, b: Int)

    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launch()
    }

    override func tearDownWithError() throws {
        app?.terminate()
    }

    // MARK: - Fixture plumbing

    private func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    /// Waits for the real `PaintGateScreen` to mount. A timeout here is a
    /// FIXTURE FAILURE — the JS bundle, Metro connection, or App.tsx fixture
    /// itself is broken — never the gate's own assertion, exactly as the
    /// Android gate distinguishes the two failure classes.
    private func waitForMount() {
        let mounted = element(Self.labelImage).waitForExistence(timeout: Self.mountTimeout)
        XCTAssertTrue(
            mounted,
            "FIXTURE FAILURE (not the gate's own assertion): PaintGateScreen never mounted " +
                "within \(Int(Self.mountTimeout))s — the JS bundle, Metro connection, or App.tsx " +
                "fixture itself is broken, not the native draw path."
        )
    }

    private func screenshotImage() -> UIImage {
        XCUIScreen.main.screenshot().image
    }

    /// Samples the RGB pixel at the geometric center of `frame` (given in
    /// screen POINTS, as `XCUIElement.frame` reports) from `image` (a
    /// full-screen `UIImage` captured at the device's screenshot scale).
    /// Returns `nil` only on a genuine harness failure (no backing
    /// `CGImage`/pixel data, or an out-of-bounds sample) — a FIXTURE FAILURE,
    /// distinct from a color mismatch.
    private func centerPixelColor(_ image: UIImage, frame: CGRect) -> RGB? {
        guard let cgImage = image.cgImage,
              let data = cgImage.dataProvider?.data,
              let bytes = CFDataGetBytePtr(data)
        else {
            return nil
        }
        let scale = image.scale
        let x = Int((frame.midX * scale).rounded())
        let y = Int((frame.midY * scale).rounded())
        guard x >= 0, y >= 0, x < cgImage.width, y < cgImage.height else {
            return nil
        }
        let bytesPerPixel = max(cgImage.bitsPerPixel / 8, 1)
        let offset = y * cgImage.bytesPerRow + x * bytesPerPixel
        guard offset + 2 < CFDataGetLength(data) else {
            return nil
        }
        // Simulator screenshot CGImages are RGBA/BGRA byte order depending on
        // OS version; both orders share R and B as the two outer bytes with G
        // in the middle, and this gate only needs approximate channel
        // separation within COLOR_TOLERANCE, so reading in RGB order and
        // relying on the ramp/tolerance check is robust to either layout for
        // every color this fixture uses (none of which are ambiguous under a
        // R/B channel swap: the ramp is neutral grey, and the fixture colors
        // are each dominated by a single, distinguishing channel).
        let r = Int(bytes[offset])
        let g = Int(bytes[offset + 1])
        let b = Int(bytes[offset + 2])
        return (r, g, b)
    }

    private func colorsClose(_ a: RGB, _ b: RGB, tolerance: Int = colorTolerance) -> Bool {
        abs(a.r - b.r) <= tolerance && abs(a.g - b.g) <= tolerance && abs(a.b - b.b) <= tolerance
    }

    /// Polls `frame`'s center pixel every `pollInterval` for up to
    /// `overlaySettleTimeout`, returning as soon as `predicate` is
    /// satisfied — never on the first sample, mirroring how `waitForMount`
    /// waits for a real condition instead of a fixed sleep. Returns the
    /// LAST sampled pixel (not `nil`) on timeout, so the caller's own
    /// assertion message still reports the real final color rather than a
    /// generic timeout error — the color mismatch remains the actual
    /// reported failure, exactly like a one-shot sample would show.
    private func pollUntilPixel(
        frame: @autoclosure () -> CGRect,
        satisfying predicate: (RGB) -> Bool
    ) -> RGB? {
        let deadline = Date().addingTimeInterval(Self.overlaySettleTimeout)
        var lastPixel: RGB?
        repeat {
            let image = screenshotImage()
            guard let pixel = centerPixelColor(image, frame: frame()) else {
                return lastPixel
            }
            lastPixel = pixel
            if predicate(pixel) {
                return pixel
            }
            Thread.sleep(forTimeInterval: Self.pollInterval)
        } while Date() < deadline
        return lastPixel
    }

    /// True when every channel of `pixel` falls within the color RAMP
    /// spanning `from`..`to` (inclusive of both ends, in either order),
    /// inflated by `tolerance` at each end — the identical semantic fix
    /// applied to the Android gate's `skeletonPaintsOverDetectedShapes`, for
    /// the identical reason (the production draw pass animates a gradient
    /// between `baseColor` and `highlightColor`, so any real capture can
    /// legitimately land at any phase between them).
    private func colorInRamp(_ pixel: RGB, from: RGB, to: RGB, tolerance: Int = colorTolerance) -> Bool {
        func channelInRange(_ value: Int, _ a: Int, _ b: Int) -> Bool {
            let lo = min(a, b) - tolerance
            let hi = max(a, b) + tolerance
            return value >= lo && value <= hi
        }
        return channelInRange(pixel.r, from.r, to.r) &&
            channelInRange(pixel.g, from.g, to.g) &&
            channelInRange(pixel.b, from.b, to.b)
    }

    private func hex(_ c: RGB) -> String {
        String(format: "#%02X%02X%02X", c.r, c.g, c.b)
    }

    // MARK: - Assertions (mirror PaintGateInstrumentedTest.kt exactly)

    /// Assertion 1: with `isLoading` true, skeleton pixels are actually
    /// painted in the region the sensor detected a shape. Fails for the
    /// right reason before the overlay view exists: the real content
    /// (`#0000FF`) is directly visible, nowhere near the grey shimmer ramp.
    func testSkeletonPaintsOverDetectedShapes() {
        waitForMount()
        let frame = element(Self.labelImage).frame
        guard let pixel = pollUntilPixel(frame: frame, satisfying: { pixel in
            self.colorInRamp(pixel, from: Self.skeletonBaseColor, to: Self.skeletonHighlightColor)
        }) else {
            XCTFail("FIXTURE FAILURE: could not sample a pixel from the screenshot at \(frame)")
            return
        }
        XCTAssertTrue(
            colorInRamp(pixel, from: Self.skeletonBaseColor, to: Self.skeletonHighlightColor),
            "Expected a skeleton pixel within the shimmer ramp " +
                "(\(hex(Self.skeletonBaseColor))..\(hex(Self.skeletonHighlightColor))) painted over " +
                "the detected image-placeholder shape while isLoading=true, but the pixel at " +
                "(\(frame.midX), \(frame.midY)) was \(hex(pixel)) — outside the ramp, so nothing " +
                "painted a skeleton there."
        )
    }

    /// Assertion 2: with `isLoading` true, the real content is NOT visible.
    func testRealContentHiddenWhileLoading() {
        waitForMount()
        let frame = element(Self.labelImage).frame
        guard let pixel = pollUntilPixel(frame: frame, satisfying: { pixel in
            !self.colorsClose(pixel, Self.contentImageColor)
        }) else {
            XCTFail("FIXTURE FAILURE: could not sample a pixel from the screenshot at \(frame)")
            return
        }
        XCTAssertFalse(
            colorsClose(pixel, Self.contentImageColor),
            "Expected the real content (\(hex(Self.contentImageColor)) image placeholder) to be " +
                "hidden while isLoading=true, but it was directly visible at \(hex(pixel)) — no " +
                "skeleton is covering it."
        )
    }

    /// Assertion 3: with `isLoading` false, the real content IS visible and
    /// no skeleton pixels remain.
    func testRealContentVisibleAndSkeletonGoneAfterLoadCompletes() {
        waitForMount()
        let toggle = element(Self.labelToggle)
        XCTAssertTrue(toggle.exists, "FIXTURE FAILURE: could not locate the isLoading toggle")
        toggle.tap()
        Thread.sleep(forTimeInterval: Self.handoffSettleSeconds)

        let imageFrame = element(Self.labelImage).frame
        let cardFrame = element(Self.labelCard).frame
        let image = screenshotImage()

        guard let imagePixel = centerPixelColor(image, frame: imageFrame) else {
            XCTFail("FIXTURE FAILURE: could not sample the image-placeholder pixel at \(imageFrame)")
            return
        }
        guard let cardPixel = centerPixelColor(image, frame: cardFrame) else {
            XCTFail("FIXTURE FAILURE: could not sample the rounded-card pixel at \(cardFrame)")
            return
        }

        XCTAssertTrue(
            colorsClose(imagePixel, Self.contentImageColor),
            "Expected the real image-placeholder content (\(hex(Self.contentImageColor))) visible " +
                "after isLoading=false, got \(hex(imagePixel))"
        )
        XCTAssertTrue(
            colorsClose(cardPixel, Self.contentCardColor),
            "Expected the real rounded-card content (\(hex(Self.contentCardColor))) visible after " +
                "isLoading=false, got \(hex(cardPixel))"
        )
        XCTAssertFalse(
            colorInRamp(imagePixel, from: Self.skeletonBaseColor, to: Self.skeletonHighlightColor),
            "No skeleton pixels should remain over the image placeholder after isLoading=false"
        )
        XCTAssertFalse(
            colorInRamp(cardPixel, from: Self.skeletonBaseColor, to: Self.skeletonHighlightColor),
            "No skeleton pixels should remain over the rounded card after isLoading=false"
        )
    }
}
