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

    // `<AutoSkeleton.Ignore>` bug-fix gate: `ignored` sits INSIDE
    // `<AutoSkeleton.Ignore>`, `ignoredSibling` is its NOT-ignored sibling in
    // the same frame.
    private static let contentIgnoredColor: RGB = (0xFF, 0x66, 0x00)
    private static let contentIgnoredSiblingColor: RGB = (0x80, 0x00, 0xFF)

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

    /// `src/native/AutoSkeleton.tsx`'s `DEFAULT_THEME.speedMs` — the shimmer
    /// clock's PERIOD. Hardcoded here for the same reason the colours above are:
    /// a drift in the production default must fail this gate loudly.
    private static let shimmerPeriodSeconds: TimeInterval = 1.4
    /// Sampling window for the across-the-cycle gate: one and a half full
    /// periods, so the sweep is guaranteed to pass through BOTH of its extremes
    /// (`-width` and `+width`) inside the window regardless of the phase the
    /// first sample happens to land on.
    private static let cycleSampleSpanSeconds: TimeInterval = shimmerPeriodSeconds * 1.5
    /// Sampled as fast as `XCUIScreen.main.screenshot()` allows; the small sleep
    /// only keeps the loop from spinning the CPU flat out.
    private static let cycleSampleInterval: TimeInterval = 0.05
    /// A one-shot sample can never see this defect, so a run that collected too
    /// few samples is a FIXTURE FAILURE, not a pass.
    private static let minCycleSamples = 12

    private static let labelToggle = "paint-gate-toggle"
    private static let labelContent = "paint-gate-content"
    private static let labelImage = "paint-gate-image"
    private static let labelCard = "paint-gate-rounded-card"
    private static let labelIgnoredContent = "paint-gate-ignored-content"
    private static let labelIgnoredSibling = "paint-gate-ignored-sibling"

    /// `src/native/AutoSkeleton.tsx`'s `LOADING_ACCESSIBILITY_LABEL`, and the
    /// exact string `src/web/AutoSkeleton.tsx` already renders inside its
    /// `role="status"` overlay. Hardcoded here on purpose (same discipline as
    /// the skeleton colours above) so a drift in the production string fails
    /// this gate loudly rather than silently.
    private static let loadingStatusLabel = "Loading"

    /// How long the real cold `getShapes` bridge round-trip plus the first
    /// overlay frame may legitimately take before the accessibility tree must
    /// reflect the loading state. Same value and same "wait for the real
    /// condition, never guess a sleep" discipline as `overlaySettleTimeout`.
    private static let accessibilitySettleTimeout: TimeInterval = 8

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
    ///
    /// G.15: this waits on `paint-gate-toggle`, NOT on `paint-gate-image` as it
    /// did before. The toggle renders in `PaintGateScreen` OUTSIDE
    /// `<AutoSkeleton>`, so it is reachable in every state. `paint-gate-image`
    /// is inside the subtree `<AutoSkeleton>` now correctly hides from assistive
    /// technology while the skeleton is painted (REQ-A11Y-1) — and XCUITest
    /// queries the same accessibility server VoiceOver does, with no
    /// "include hidden elements" escape hatch of the kind UiAutomator's
    /// `FLAG_INCLUDE_NOT_IMPORTANT_VIEWS` gives the Android gate. Waiting on a
    /// deliberately-hidden element would time out on every single test.
    private func waitForMount() {
        let mounted = element(Self.labelToggle).waitForExistence(timeout: Self.mountTimeout)
        XCTAssertTrue(
            mounted,
            "FIXTURE FAILURE (not the gate's own assertion): PaintGateScreen never mounted " +
                "within \(Int(Self.mountTimeout))s — the JS bundle, Metro connection, or App.tsx " +
                "fixture itself is broken, not the native draw path."
        )
    }

    /// Returns the on-screen frame of each requested content element, measured
    /// while the app is in its LOADED state, then leaves the app on a FRESH,
    /// COLD `isLoading=true` first load for the caller's pixel assertions.
    ///
    /// G.15, and the direct cost of fixing REQ-A11Y-1 on iOS. These gates used
    /// to read `element(id).frame` directly during loading. That is no longer
    /// possible and MUST NOT be worked around by hardcoding coordinates: the
    /// real content is now correctly excluded from the accessibility hierarchy
    /// while the skeleton is painted, and XCUITest sees exactly that hierarchy.
    ///
    /// So the frames are read where the content genuinely IS reachable — after
    /// the real `isLoading` toggle — and the app is then terminated and
    /// relaunched to get back to a real cold first load. Every coordinate still
    /// comes from a real accessibility query against the real running app;
    /// none is guessed, and a layout change still cannot cause a false RED.
    ///
    /// The frames are valid across the relaunch because layout does not depend
    /// on `isLoading` at all: ADR-16 reveal-before-hide keeps `props.children`
    /// mounted in both states, the overlay is `StyleSheet.absoluteFill`, and
    /// every fixture block has a fixed size (`examples/bare-rn/App.tsx`).
    private func contentFrames(_ identifiers: [String]) -> [String: CGRect] {
        waitForMount()

        let toggle = element(Self.labelToggle)
        XCTAssertTrue(toggle.exists, "FIXTURE FAILURE: could not locate the isLoading toggle")
        toggle.tap()

        var frames: [String: CGRect] = [:]
        for identifier in identifiers {
            let el = element(identifier)
            XCTAssertTrue(
                el.waitForExistence(timeout: Self.accessibilitySettleTimeout),
                "FIXTURE FAILURE: \"\(identifier)\" never became reachable in the LOADED state, " +
                    "where the real content must always be exposed to assistive technology."
            )
            frames[identifier] = el.frame
        }

        app.terminate()
        app.launch()
        waitForMount()

        return frames
    }

    private func frame(_ frames: [String: CGRect], _ identifier: String) -> CGRect {
        guard let frame = frames[identifier] else {
            XCTFail("FIXTURE FAILURE: no frame captured for \"\(identifier)\"")
            return .zero
        }
        return frame
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
        let frames = contentFrames([Self.labelImage])
        let frame = frame(frames, Self.labelImage)
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
        let frames = contentFrames([Self.labelImage])
        let frame = frame(frames, Self.labelImage)
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

    /// `<AutoSkeleton.Ignore>` bug-fix gate (this session's brief): with
    /// `isLoading` true, the region wrapped in `<AutoSkeleton.Ignore>` must
    /// show NO skeleton pixels (only its own fixture color), while its
    /// NOT-ignored sibling in the exact same frame DOES show real skeleton
    /// pixels. Both halves matter — asserting only the ignored half would
    /// pass even if the whole skeleton failed to render at all.
    func testIgnoredRegionPaintsNoSkeletonWhileSiblingDoes() {
        let frames = contentFrames([Self.labelIgnoredContent, Self.labelIgnoredSibling])
        let ignoredFrame = frame(frames, Self.labelIgnoredContent)
        let siblingFrame = frame(frames, Self.labelIgnoredSibling)

        // The sibling settling into the shimmer ramp is the real "the overlay
        // has mounted" signal (mirrors `testSkeletonPaintsOverDetectedShapes`'
        // own `pollUntilPixel` race-avoidance) — sampling both regions from
        // the SAME poll-settled screenshot keeps the two assertions in one
        // real frame.
        guard let siblingPixel = pollUntilPixel(frame: siblingFrame, satisfying: { pixel in
            self.colorInRamp(pixel, from: Self.skeletonBaseColor, to: Self.skeletonHighlightColor)
        }) else {
            XCTFail("FIXTURE FAILURE: could not sample a pixel from the screenshot at \(siblingFrame)")
            return
        }
        let image = screenshotImage()
        guard let ignoredPixel = centerPixelColor(image, frame: ignoredFrame) else {
            XCTFail("FIXTURE FAILURE: could not sample the ignored-region pixel at \(ignoredFrame)")
            return
        }

        XCTAssertTrue(
            colorsClose(ignoredPixel, Self.contentIgnoredColor),
            "Expected the <AutoSkeleton.Ignore>-wrapped region to show its own fixture " +
                "color (\(hex(Self.contentIgnoredColor))) while isLoading=true (no skeleton " +
                "should ever be painted over ignored content), but the pixel was " +
                "\(hex(ignoredPixel))."
        )
        XCTAssertFalse(
            colorInRamp(ignoredPixel, from: Self.skeletonBaseColor, to: Self.skeletonHighlightColor),
            "Expected NO skeleton ramp pixel over the <AutoSkeleton.Ignore>-wrapped region " +
                "while isLoading=true, but the pixel at (\(ignoredFrame.midX), " +
                "\(ignoredFrame.midY)) was \(hex(ignoredPixel)) — inside the shimmer ramp."
        )
        XCTAssertTrue(
            colorInRamp(siblingPixel, from: Self.skeletonBaseColor, to: Self.skeletonHighlightColor),
            "Expected the NOT-ignored sibling region to show a real skeleton pixel within " +
                "the shimmer ramp (\(hex(Self.skeletonBaseColor))..\(hex(Self.skeletonHighlightColor))) " +
                "in the SAME frame the ignored region was sampled from — proving the skeleton " +
                "itself painted at all, not just that the ignored region happened to show " +
                "nothing — but the pixel was \(hex(siblingPixel))."
        )
        XCTAssertFalse(
            colorsClose(siblingPixel, Self.contentIgnoredSiblingColor),
            "The NOT-ignored sibling's own fixture color (\(hex(Self.contentIgnoredSiblingColor))) " +
                "should be hidden by the skeleton while isLoading=true, but it was directly visible."
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

    // MARK: - G.15 accessibility gate (mirrors AccessibilityGateInstrumentedTest.kt)

    /// The defect these three tests close: `<AutoSkeleton>` correctly hid its
    /// own skeleton OVERLAY from assistive technology, but never hid
    /// `props.children` — the REAL content that ADR-16 reveal-before-hide keeps
    /// mounted underneath the overlay at all times. So VoiceOver read content
    /// the sighted user cannot see: placeholder text, empty strings, stale
    /// data. `src/web/AutoSkeleton.tsx` had always done the equivalent
    /// (`aria-hidden` around the real content while the overlay shows); native
    /// did not.
    ///
    /// Why a unit test could not replace this: `ios/AutoskeletonAccessibility.swift`
    /// shipped a fully unit-tested `setLoading(_:on:)` helper with SIX green
    /// unit tests and ZERO production call sites. Green unit tests on dead code
    /// are exactly the defect. Only an assertion against the accessibility
    /// hierarchy of a REAL RUNNING APP distinguishes "the mechanism exists"
    /// from "the mechanism runs" — and XCUITest queries that hierarchy through
    /// the same accessibility server VoiceOver does, so
    /// `UIView.accessibilityElementsHidden` genuinely removes a subtree from
    /// what these queries can reach.

    /// Matches by accessibility LABEL rather than identifier (`testID`). The
    /// loading status element is contractually identified by the string a
    /// screen reader actually speaks, exactly like web's visually-hidden
    /// `<span>Loading</span>` — it deliberately carries no `testID`, so a
    /// production identifier never exists purely for a test's convenience.
    private func elementWithLabel(_ label: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    /// Polls `condition` every `pollInterval` for up to `timeout`, returning as
    /// soon as it holds — the same discipline `pollUntilPixel` uses, never a
    /// fixed sleep.
    private func waitUntil(timeout: TimeInterval, _ condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if condition() { return true }
            Thread.sleep(forTimeInterval: Self.pollInterval)
        } while Date() < deadline
        return condition()
    }

    /// The control assertion, asserted alongside EVERY "content is absent"
    /// assertion below. `paint-gate-toggle` is a real, accessible `Pressable`
    /// that sits OUTSIDE `<AutoSkeleton>`, so it must be reachable in every
    /// hierarchy this gate inspects. Without it, "the element does not exist"
    /// would be satisfied just as well by a crashed app, an unmounted screen,
    /// or a broken query — the exact way an absence assertion goes vacuous.
    private func assertQueryIsWorking() {
        XCTAssertTrue(
            element(Self.labelToggle).exists,
            "CONTROL FAILURE: \"\(Self.labelToggle)\" (an accessible Pressable OUTSIDE " +
                "<AutoSkeleton>, so never affected by this fix) was itself unreachable. Every " +
                "'content is absent' assertion in this class is meaningless unless this element " +
                "is present in the same hierarchy — the app is down or the query is broken."
        )
    }

    /// The SECOND control, and the one that closes the last way an absence
    /// assertion could pass for the wrong reason. `paint-gate-toggle` proves the
    /// app is up, but it renders in `PaintGateScreen` OUTSIDE `<AutoSkeleton>` —
    /// on its own it cannot rule out "the `<AutoSkeleton>` subtree simply had not
    /// been attached yet when we looked".
    ///
    /// The `Loading` status element is mounted by `<AutoSkeleton>` itself, and
    /// ONLY while `overlayVisible` is true — i.e. only once the cold `getShapes`
    /// round-trip resolved and the real overlay is painted. Requiring it in the
    /// SAME hierarchy as the missing content is positive proof that the component
    /// is mounted and actively showing a skeleton at the exact instant the
    /// content was found to be absent.
    private func assertSkeletonIsActuallyShowing() {
        XCTAssertTrue(
            elementWithLabel(Self.loadingStatusLabel).exists,
            "CONTROL FAILURE: the \"\(Self.loadingStatusLabel)\" status element (mounted by " +
                "<AutoSkeleton> itself, and only while the overlay is actually painted) was " +
                "missing from the SAME hierarchy the content was found absent in. Without it, " +
                "'the content is not in the hierarchy' could just mean the <AutoSkeleton> " +
                "subtree was never attached."
        )
    }

    /// REQ-A11Y-1, hidden half: while the skeleton overlay is painted, the real
    /// content underneath it must be EXCLUDED from the accessibility hierarchy.
    /// Every content element is checked, not just one:
    /// `accessibilityElementsHidden` is a SUBTREE mechanism, so a fix that only
    /// hid the immediate child while leaving deeper descendants exposed would
    /// still read stale data to VoiceOver.
    func testRealContentIsExcludedFromAccessibilityWhileTheSkeletonShows() {
        waitForMount()

        let hidden = waitUntil(timeout: Self.accessibilitySettleTimeout) {
            !self.element(Self.labelImage).exists
        }

        assertQueryIsWorking()
        assertSkeletonIsActuallyShowing()
        XCTAssertTrue(
            hidden,
            "Expected the real content subtree to be EXCLUDED from the accessibility hierarchy " +
                "while the skeleton overlay is painted, but \"\(Self.labelImage)\" was still " +
                "reachable by an assistive technology after \(Int(Self.accessibilitySettleTimeout))s. " +
                "VoiceOver would read content the user cannot see."
        )
        XCTAssertFalse(
            element(Self.labelContent).exists,
            "Expected the WHOLE content subtree to be excluded, but the container " +
                "\"\(Self.labelContent)\" was still reachable."
        )
        XCTAssertFalse(
            element(Self.labelCard).exists,
            "Expected the WHOLE content subtree to be excluded, but the deeper descendant " +
                "\"\(Self.labelCard)\" was still reachable — a shallow hide is not a subtree hide."
        )
    }

    /// REQ-A11Y-1, RESTORED half. A gate that only proves content disappears
    /// cannot tell you it ever comes back — an implementation that hid the
    /// content permanently would pass the test above and leave the app unusable
    /// with VoiceOver. This test requires BOTH transitions in one run: first the
    /// hidden state (so it can never pass against an implementation that simply
    /// never hides anything), then the restored state after the real
    /// `isLoading` toggle and the real ADR-16 handoff.
    func testRealContentReturnsToAccessibilityAfterTheHandoffCompletes() {
        waitForMount()

        let hidden = waitUntil(timeout: Self.accessibilitySettleTimeout) {
            !self.element(Self.labelImage).exists
        }
        assertQueryIsWorking()
        assertSkeletonIsActuallyShowing()
        XCTAssertTrue(
            hidden,
            "PRECONDITION: this test asserts the content is RESTORED, which is only meaningful " +
                "once it was genuinely hidden first. \"\(Self.labelImage)\" never left the " +
                "accessibility hierarchy while the skeleton was painted."
        )

        let toggle = element(Self.labelToggle)
        XCTAssertTrue(toggle.exists, "FIXTURE FAILURE: could not locate the isLoading toggle")
        toggle.tap()

        let restored = waitUntil(timeout: Self.accessibilitySettleTimeout) {
            self.element(Self.labelImage).exists
        }
        XCTAssertTrue(
            restored,
            "Expected the real content to RETURN to the accessibility hierarchy after " +
                "isLoading=false and the ADR-16 handoff settled, but \"\(Self.labelImage)\" was " +
                "still excluded after \(Int(Self.accessibilitySettleTimeout))s — the content is " +
                "permanently invisible to VoiceOver."
        )
        XCTAssertTrue(
            element(Self.labelContent).exists,
            "Expected the whole content subtree to return, but \"\(Self.labelContent)\" was still excluded."
        )
        XCTAssertTrue(
            element(Self.labelCard).exists,
            "Expected the whole content subtree to return, but \"\(Self.labelCard)\" was still excluded."
        )
    }

    /// REQ-A11Y-2, as actually shipped. `src/web/AutoSkeleton.tsx` renders a
    /// visually-hidden `Loading` inside a `role="status"` overlay: a STATICALLY
    /// READABLE element, never an interrupting one. Native mirrors that with a
    /// zero-footprint accessible `View` carrying `accessibilityLabel="Loading"`.
    ///
    /// It is deliberately NOT `AccessibilityInfo.announceForAccessibility`,
    /// which INTERRUPTS VoiceOver mid-utterance — see this session's tasks.md
    /// entry for the full argument. iOS has no polite-live-region equivalent
    /// exposed through React Native (`accessibilityLiveRegion` is Android-only),
    /// which is exactly why the readable element, not an announcement, is the
    /// portable mechanism.
    func testLoadingStatusIsExposedWhileLoadingAndRemovedAfterHandoff() {
        waitForMount()

        let statusAppeared = waitUntil(timeout: Self.accessibilitySettleTimeout) {
            self.elementWithLabel(Self.loadingStatusLabel).exists
        }
        assertQueryIsWorking()
        XCTAssertTrue(
            statusAppeared,
            "Expected an accessible \"\(Self.loadingStatusLabel)\" status element while the " +
                "skeleton is painted — with the real content hidden, a VoiceOver user would " +
                "otherwise encounter an EMPTY region and no indication anything is loading."
        )

        let toggle = element(Self.labelToggle)
        XCTAssertTrue(toggle.exists, "FIXTURE FAILURE: could not locate the isLoading toggle")
        toggle.tap()

        let statusRemoved = waitUntil(timeout: Self.accessibilitySettleTimeout) {
            !self.elementWithLabel(Self.loadingStatusLabel).exists
        }
        assertQueryIsWorking()
        XCTAssertTrue(
            statusRemoved,
            "Expected the \"\(Self.loadingStatusLabel)\" status element to be GONE once loading " +
                "finished and the handoff settled, but it was still in the accessibility " +
                "hierarchy after \(Int(Self.accessibilitySettleTimeout))s — a permanent 'Loading' " +
                "announcement on loaded content is worse than none."
        )
    }

    // MARK: - G.18: the covered region must be STATIONARY across the cycle

    /// Every other assertion in this file samples a SINGLE frame — `pollUntilPixel`
    /// returns as soon as ONE sample satisfies its predicate — and the colour
    /// check is a RAMP check, deliberately built to tolerate the sweep. That
    /// combination is blind to the class of defect where the shimmer translates
    /// the SKELETON instead of translating a highlight THROUGH it: at some
    /// instant in every cycle the skeleton does sit over the probe, so a
    /// poll-until-satisfied gate always finds its frame and passes, while for
    /// most of the cycle the real content is exposed.
    ///
    /// This gate samples ACROSS one and a half full 1400 ms periods instead and
    /// requires EVERY sample to be covered, at two different probe points. It is
    /// the on-device sibling of
    /// `AutoskeletonRendererTier1Tests.testAPointOverContentStaysCoveredAndOpaque
    /// AcrossTheWholeShimmerCycle`, which asserts the same invariant against the
    /// layer tree directly.
    func testSkeletonCoverageStaysStationaryAcrossAWholeShimmerCycle() {
        let frames = contentFrames([Self.labelImage, Self.labelCard])
        let imageFrame = frame(frames, Self.labelImage)
        let cardFrame = frame(frames, Self.labelCard)

        // Same settle discipline as every other assertion here: wait for the
        // real overlay to exist before judging it, never a guessed sleep.
        guard pollUntilPixel(frame: imageFrame, satisfying: { pixel in
            self.colorInRamp(pixel, from: Self.skeletonBaseColor, to: Self.skeletonHighlightColor)
        }) != nil else {
            XCTFail("FIXTURE FAILURE: could not sample a pixel from the screenshot at \(imageFrame)")
            return
        }

        var imageSamples: [RGB] = []
        var cardSamples: [RGB] = []
        let start = Date()
        let deadline = start.addingTimeInterval(Self.cycleSampleSpanSeconds)
        repeat {
            let image = screenshotImage()
            guard let imagePixel = centerPixelColor(image, frame: imageFrame),
                  let cardPixel = centerPixelColor(image, frame: cardFrame)
            else {
                XCTFail("FIXTURE FAILURE: could not sample the screenshot mid-cycle")
                return
            }
            imageSamples.append(imagePixel)
            cardSamples.append(cardPixel)
            Thread.sleep(forTimeInterval: Self.cycleSampleInterval)
        } while Date() < deadline
        let span = Date().timeIntervalSince(start)

        XCTAssertGreaterThanOrEqual(
            imageSamples.count, Self.minCycleSamples,
            "FIXTURE FAILURE: only \(imageSamples.count) samples in \(span)s — too few to " +
                "observe a \(Self.shimmerPeriodSeconds)s cycle, so this gate proved nothing."
        )
        XCTAssertGreaterThanOrEqual(
            span, Self.shimmerPeriodSeconds,
            "FIXTURE FAILURE: sampled for only \(span)s, less than one full shimmer period."
        )

        assertCoveredAtEverySample(
            imageSamples,
            probe: "paint-gate-image",
            contentColor: Self.contentImageColor,
            frame: imageFrame
        )
        assertCoveredAtEverySample(
            cardSamples,
            probe: "paint-gate-rounded-card",
            contentColor: Self.contentCardColor,
            frame: cardFrame
        )

        // Anti-vacuity: a completely frozen screen would satisfy every
        // assertion above. The shimmer must still be MOVING — the highlight
        // sweeps through the probe once per period, so the sampled colour
        // cannot be byte-identical across a full cycle.
        XCTAssertGreaterThan(
            Set(imageSamples.map { "\($0.r),\($0.g),\($0.b)" }).count, 1,
            "Every one of the \(imageSamples.count) samples over \(span)s was the exact same " +
                "colour — the shimmer is not animating at all, so \"the covered region never " +
                "moved\" is vacuously true rather than earned."
        )
    }

    /// Fails on the FIRST uncovered sample with its index, so the report names
    /// the phase at which the skeleton stopped covering the content.
    private func assertCoveredAtEverySample(
        _ samples: [RGB],
        probe: String,
        contentColor: RGB,
        frame: CGRect,
        rampFrom: RGB = PaintGateUITests.skeletonBaseColor,
        rampTo: RGB = PaintGateUITests.skeletonHighlightColor
    ) {
        for (index, pixel) in samples.enumerated() {
            let inRamp = colorInRamp(pixel, from: rampFrom, to: rampTo)
            let isContent = colorsClose(pixel, contentColor)
            XCTAssertFalse(
                isContent,
                "At sample \(index + 1)/\(samples.count) of one shimmer cycle, the real content " +
                    "(\(hex(contentColor))) was DIRECTLY VISIBLE at \(probe) " +
                    "(\(frame.midX), \(frame.midY)). The skeleton is only covering it at part " +
                    "of the cycle — the covered region is travelling with the sweep instead of " +
                    "staying put while a highlight sweeps through it."
            )
            XCTAssertTrue(
                inRamp,
                "At sample \(index + 1)/\(samples.count) of one shimmer cycle, \(probe) was " +
                    "\(hex(pixel)) — outside the shimmer ramp " +
                    "(\(hex(rampFrom))..\(hex(rampTo))). The " +
                    "skeleton must cover this point at EVERY phase, not merely at some of them."
            )
        }
    }

    // MARK: - Tier-2 (Skia + Reanimated) gates
    //
    // Everything below runs against the `tier2` screen of
    // `examples/bare-rn/App.tsx`, which is wrapped in
    // `<SkeletonProvider overlay={createSkiaOverlay(...)}>` — the real,
    // documented ADR-5 opt-in a consumer writes, with the two optional peers
    // imported by the APP's own module graph. There is no test-only backdoor
    // into tier-2 and there must never be one: the thing being gated is
    // precisely that the shipped opt-in path works.
    //
    // The `card` and `list` screens deliberately stay on tier-1, so every
    // pre-existing gate in this file keeps exercising the default tier. Making
    // the whole app tier-2 would have silently deleted tier-1's on-device
    // coverage while every one of its assertions stayed green.

    /// `examples/bare-rn/App.tsx` `TIER2_FIXTURE`.
    private static let tier2Root = "tier2-root"
    private static let tier2Toggle = "tier2-toggle"
    private static let tier2Renderer = "tier2-renderer"
    private static let tier2Early = "tier2-early-block"
    private static let tier2Late = "tier2-late-block"
    private static let tier2EarlyColor: RGB = (0x00, 0x00, 0xFF)
    private static let tier2LateColor: RGB = (0x00, 0xA6, 0x51)
    /// `TIER2_FIXTURE.theme` — a DELIBERATELY high-contrast ramp, 174 units per
    /// channel end to end against the default theme's 19. See that fixture's
    /// doc comment: with a 19-unit ramp, any tolerance large enough to absorb
    /// simulator compositor noise is wider than the whole signal, and the phase
    /// gate below passes vacuously. That was observed against a planted defect,
    /// not assumed.
    private static let tier2BaseColor: RGB = (0x3A, 0x3A, 0x3A)
    private static let tier2HighlightColor: RGB = (0xE8, 0xE8, 0xE8)
    /// End-to-end excursion of the tier-2 ramp, per channel.
    private static let tier2RampSpan = 0xE8 - 0x3A
    /// `TIER2_FIXTURE.lateMountMs` (700 ms) plus generous slack for the second
    /// block's own cold `getShapes` round-trip. Real fixture timing, not a
    /// guessed sleep: the fixture's mount delay is the thing being waited on,
    /// and it is what creates the phase offset the ADR-8 gate below exists to
    /// detect.
    private static let tier2LateMountSettleSeconds: TimeInterval = 3

    /// Walks the screen switcher card -> list -> tier2. Two taps, because the
    /// switcher cycles; a timeout here is a FIXTURE FAILURE.
    private func goToTier2Screen() {
        waitForMount()
        let screenToggle = element(PAINT_GATE_SCREEN_TOGGLE)
        XCTAssertTrue(
            screenToggle.waitForExistence(timeout: Self.mountTimeout),
            "FIXTURE FAILURE: the screen switcher never mounted."
        )
        screenToggle.tap()
        screenToggle.tap()
        XCTAssertTrue(
            element(Self.tier2Root).waitForExistence(timeout: Self.mountTimeout),
            "FIXTURE FAILURE: the tier-2 screen never mounted after two switcher taps."
        )
    }

    private let PAINT_GATE_SCREEN_TOGGLE = "paint-gate-screen-toggle"

    /// Reads both tier-2 block frames where the content is genuinely reachable
    /// (the LOADED state — REQ-A11Y-1 hides it while the skeleton paints), then
    /// returns the app to a fresh COLD `isLoading` cycle for the caller's pixel
    /// assertions. Same discipline and same rationale as `contentFrames`; no
    /// coordinate is ever guessed.
    ///
    /// The relaunch is NOT ceremony and must not be replaced by a second toggle
    /// tap. Toggling `isLoading` back to true on an instance whose content has
    /// already been shown is REQ-PTR-1's stale-while-revalidate path, where
    /// `shouldRunHandoffCycle` suppresses the overlay ENTIRELY and the real
    /// content stays visible by design — observed here first as a tier-2 gate
    /// failing with "the real content (#0000FF) was DIRECTLY VISIBLE at sample
    /// 1", which was the fixture doing the wrong thing, not the renderer.
    private func tier2Frames() -> (early: CGRect, late: CGRect) {
        goToTier2Screen()
        waitForLateTier2Block()

        let toggle = element(Self.tier2Toggle)
        XCTAssertTrue(toggle.exists, "FIXTURE FAILURE: could not locate the tier-2 isLoading toggle")
        toggle.tap()

        var frames: [String: CGRect] = [:]
        for identifier in [Self.tier2Early, Self.tier2Late] {
            let el = element(identifier)
            XCTAssertTrue(
                el.waitForExistence(timeout: Self.accessibilitySettleTimeout),
                "FIXTURE FAILURE: \"\(identifier)\" never became reachable in the LOADED state."
            )
            frames[identifier] = el.frame
        }

        app.terminate()
        app.launch()
        goToTier2Screen()
        waitForLateTier2Block()

        return (frames[Self.tier2Early] ?? .zero, frames[Self.tier2Late] ?? .zero)
    }

    /// The second tier-2 block mounts on a `TIER2_FIXTURE.lateMountMs` timer, so
    /// sampling before it exists would race the fixture rather than the library.
    /// It is only reachable through the accessibility tree while its skeleton is
    /// NOT painted, so this waits on the tier-2 TOGGLE plus the fixture's own
    /// mount delay instead of on the block itself.
    private func waitForLateTier2Block() {
        XCTAssertTrue(
            element(Self.tier2Toggle).waitForExistence(timeout: Self.mountTimeout),
            "FIXTURE FAILURE: the tier-2 screen's toggle never mounted."
        )
        Thread.sleep(forTimeInterval: Self.tier2LateMountSettleSeconds)
    }

    /// Samples both probes from the SAME screenshot, repeatedly, for
    /// `cycleSampleSpanSeconds`. Returning paired samples from one rasterization
    /// is what makes the phase comparison meaningful: two probes read from two
    /// different frames could differ purely because time passed between them.
    private func sampleAcrossCycle(_ a: CGRect, _ b: CGRect) -> (a: [RGB], b: [RGB], span: TimeInterval) {
        var aSamples: [RGB] = []
        var bSamples: [RGB] = []
        let start = Date()
        let deadline = start.addingTimeInterval(Self.cycleSampleSpanSeconds)
        repeat {
            let image = screenshotImage()
            guard let pa = centerPixelColor(image, frame: a), let pb = centerPixelColor(image, frame: b) else {
                XCTFail("FIXTURE FAILURE: could not sample the screenshot mid-cycle")
                return (aSamples, bSamples, Date().timeIntervalSince(start))
            }
            aSamples.append(pa)
            bSamples.append(pb)
            Thread.sleep(forTimeInterval: Self.cycleSampleInterval)
        } while Date() < deadline
        return (aSamples, bSamples, Date().timeIntervalSince(start))
    }

    /// RISK-8's own stated detection signal, both halves of it.
    ///
    /// The `card` screen has NOT opted in, and both optional peers ARE
    /// installed and linked in this app. It must still report `native`. Before
    /// this session that assertion would have been meaningless in both
    /// directions at once: the tier was chosen by a `require()` with a variable
    /// specifier, which Metro compiles to an unconditional throw, so the probe
    /// answered "peers absent" no matter what — AND `SkiaShimmerOverlay` had no
    /// call site anywhere in the library, so tier-1 drew regardless of the
    /// answer. Verified on this exact simulator before the fix:
    /// `onMetrics.renderer` reported `native` with Skia 2.11.1 and Reanimated
    /// 4.6.0 installed, pods built and linked.
    func testTierIsReportedByWhatActuallyDrewNotByWhatIsInstalled() {
        waitForMount()
        let toggle = element(Self.labelToggle)
        XCTAssertTrue(toggle.exists, "FIXTURE FAILURE: could not locate the isLoading toggle")
        toggle.tap()
        XCTAssertEqual(
            awaitRendererReadout("paint-gate-renderer"), "native",
            "The default `card` screen never opted in to tier-2, but both optional peers are " +
                "installed in this app. It must still report the tier that actually drew."
        )

        goToTier2Screen()
        let tier2Toggle = element(Self.tier2Toggle)
        XCTAssertTrue(tier2Toggle.waitForExistence(timeout: Self.mountTimeout), "FIXTURE FAILURE: no tier-2 toggle")
        tier2Toggle.tap()
        XCTAssertEqual(
            awaitRendererReadout(Self.tier2Renderer), "skia",
            "The tier-2 screen passed a real `createSkiaOverlay(...)` to `<SkeletonProvider overlay>`, " +
                "so `onMetrics.renderer` must report `skia` — and it must report it because Skia DREW, " +
                "not because a probe found a package on disk."
        )
    }

    /// Reads `<id>:<kind>` off the fixture's readout element, waiting out the
    /// `pending` state that precedes the first `onMetrics` callback.
    private func awaitRendererReadout(_ identifier: String) -> String {
        let readout = element(identifier)
        XCTAssertTrue(
            readout.waitForExistence(timeout: Self.accessibilitySettleTimeout),
            "FIXTURE FAILURE: renderer readout \"\(identifier)\" never appeared."
        )
        let deadline = Date().addingTimeInterval(Self.accessibilitySettleTimeout)
        var label = readout.label
        while label.hasSuffix(":pending") && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.1)
            label = readout.label
        }
        guard let kind = label.split(separator: ":").last.map(String.init) else {
            XCTFail("FIXTURE FAILURE: unreadable renderer readout \"\(label)\"")
            return ""
        }
        return kind
    }

    /// The tier-2 sibling of
    /// `testSkeletonCoverageStaysStationaryAcrossAWholeShimmerCycle`, and it
    /// exists for exactly the reason that one does: every other pixel assertion
    /// in this file samples a SINGLE frame against a colour RAMP that was
    /// deliberately built to tolerate the sweep, so the combination is blind to
    /// a shimmer that translates the SKELETON instead of translating a
    /// highlight THROUGH it. A gate that tolerates variation along the axis a
    /// defect moves cannot see that defect.
    ///
    /// Tier-2 has that failure mode available to it in a form tier-1 does not:
    /// the Skia mask path and the Skia gradient are two independent nodes, and
    /// a `<Group transform>` or a mask offset applied one level too high would
    /// move both together while every sampled pixel stayed inside the ramp.
    func testTier2SkeletonCoverageStaysStationaryAcrossAWholeShimmerCycle() {
        let frames = tier2Frames()

        guard pollUntilPixel(frame: frames.early, satisfying: { pixel in
            self.colorInRamp(pixel, from: Self.tier2BaseColor, to: Self.tier2HighlightColor)
        }) != nil else {
            XCTFail("FIXTURE FAILURE: could not sample a pixel at \(frames.early)")
            return
        }

        let samples = sampleAcrossCycle(frames.early, frames.late)

        XCTAssertGreaterThanOrEqual(
            samples.a.count, Self.minCycleSamples,
            "FIXTURE FAILURE: only \(samples.a.count) samples in \(samples.span)s — too few to " +
                "observe a \(Self.shimmerPeriodSeconds)s cycle, so this gate proved nothing."
        )
        XCTAssertGreaterThanOrEqual(
            samples.span, Self.shimmerPeriodSeconds,
            "FIXTURE FAILURE: sampled for only \(samples.span)s, less than one full shimmer period."
        )

        assertCoveredAtEverySample(
            samples.a, probe: Self.tier2Early, contentColor: Self.tier2EarlyColor, frame: frames.early,
            rampFrom: Self.tier2BaseColor, rampTo: Self.tier2HighlightColor
        )
        assertCoveredAtEverySample(
            samples.b, probe: Self.tier2Late, contentColor: Self.tier2LateColor, frame: frames.late,
            rampFrom: Self.tier2BaseColor, rampTo: Self.tier2HighlightColor
        )

        // Anti-vacuity: a completely frozen screen satisfies every assertion
        // above. Expressed as a FRACTION OF THE RAMP rather than "more than one
        // distinct colour", which a single unit of compositor dither satisfies.
        let excursion = channelExcursion(samples.a)
        XCTAssertGreaterThanOrEqual(
            excursion, Self.tier2RampSpan / 2,
            "The tier-2 shimmer only varied by \(excursion) units across \(samples.span)s, out of " +
                "a \(Self.tier2RampSpan)-unit ramp — it is not sweeping through this probe, so " +
                "\"the covered region never moved\" is vacuously true rather than earned."
        )
    }

    /// ADR-8, in the only form a screen can express it: two skeletons that
    /// STARTED AT DIFFERENT TIMES must be at the same phase.
    ///
    /// The fixture mounts the second block `TIER2_FIXTURE.lateMountMs` after the
    /// first, so a renderer that starts its own `withRepeat` from zero on mount
    /// — which is exactly what tier-2 did before this session — puts the two
    /// blocks permanently out of phase by that offset. No single-instance gate
    /// can see that: each block on its own stays inside the ramp at every
    /// sample, sweeps at the right rate, and covers its content perfectly. The
    /// defect only exists BETWEEN them.
    func testTier2InstancesMountedAtDifferentTimesShimmerInPhase() {
        let frames = tier2Frames()

        guard pollUntilPixel(frame: frames.early, satisfying: { pixel in
            self.colorInRamp(pixel, from: Self.skeletonBaseColor, to: Self.skeletonHighlightColor)
        }) != nil else {
            XCTFail("FIXTURE FAILURE: could not sample a pixel at \(frames.early)")
            return
        }

        let samples = sampleAcrossCycle(frames.early, frames.late)

        XCTAssertGreaterThanOrEqual(
            samples.a.count, Self.minCycleSamples,
            "FIXTURE FAILURE: only \(samples.a.count) paired samples in \(samples.span)s."
        )
        XCTAssertGreaterThanOrEqual(
            samples.span, Self.shimmerPeriodSeconds,
            "FIXTURE FAILURE: sampled for only \(samples.span)s, less than one full shimmer period."
        )

        // ANTI-VACUITY, deliberately BEFORE the phase assertion: two
        // STATIONARY skeletons are trivially "in phase". This gate is only
        // meaningful if the shimmer genuinely swept a large part of the ramp
        // through both probes inside the window, so a frozen — or barely
        // moving — screen must fail HERE rather than pass below.
        //
        // The threshold is a FRACTION OF THE RAMP, not "more than one distinct
        // colour". `Set(samples).count > 1` is satisfied by a single unit of
        // compositor dither and proves nothing; requiring most of the ramp to
        // actually pass through the probe is the assertion that has teeth.
        let minExcursion = Self.tier2RampSpan / 2
        for (label, series) in [("EARLY", samples.a), ("LATE", samples.b)] {
            let excursion = channelExcursion(series)
            XCTAssertGreaterThanOrEqual(
                excursion, minExcursion,
                "The \(label) tier-2 block only varied by \(excursion) units across " +
                    "\(samples.span)s, out of a \(Self.tier2RampSpan)-unit ramp. The shimmer is " +
                    "not sweeping through this probe, so \"the two blocks are in phase\" would be " +
                    "vacuously true rather than earned."
            )
        }

        // THE PHASE ASSERTION, AND AN HONEST TOLERANCE.
        //
        // The tolerance is DERIVED FROM MEASUREMENT, not chosen to make this
        // green. Three facts fix it:
        //
        //  * With the shared origin REMOVED (a deliberately planted "phase = 0"
        //    defect), the two blocks measured 167 units apart out of 174 —
        //    essentially antiphase, which is what a 700 ms mount offset against
        //    a 1400 ms period must produce.
        //  * With the shared origin in place, iOS measured within 32 units and
        //    Android measured 60 and 64 units in two of three runs.
        //  * That residual is NOT noise and NOT a defect in the join. It is the
        //    JS-to-UI-thread dispatch latency: `tier2PhaseAt` is evaluated on
        //    the JS thread inside an effect, and the animation it produces
        //    begins on the UI thread whenever Reanimated next processes it.
        //    ~60 units of a 174-unit ramp is ~0.17 of a period, i.e. ~240 ms —
        //    entirely plausible for a debug bundle on an emulator immediately
        //    after a `getShapes` bridge round-trip.
        //
        // Reanimated's public API cannot close that gap: every animation it
        // builds is START-RELATIVE (`withTiming.onStart` stamps
        // `animation.startTime = now`), `withDelay` clamps a negative delay to
        // zero (`if (now - startTime >= delayMs)`, so it can wait but never
        // seek), and the only absolute clock, `global._getAnimationTimestamp()`,
        // is declared in `privateGlobals.d.ts` and is not public API. So exact
        // phase LOCK is not achievable here; joining the shared wave to within
        // the dispatch latency is.
        //
        // 80 is therefore what this gate can honestly assert: it is above the
        // measured residual on the slower of the two platforms and less than
        // half the divergence the defect it exists to catch produces. It is
        // NOT a widened tolerance hiding a failure — the pre-fix code fails it
        // by more than 2x.
        //
        // Both probes sit at the same X within their own equally-wide, equally
        // positioned blocks, so at any instant one shared wave puts the same
        // point of the gradient over both.
        let phaseTolerance = 80
        var worst = 0
        var worstIndex = 0
        for (index, pair) in zip(samples.a, samples.b).enumerated() {
            let delta = max(abs(pair.0.r - pair.1.r), max(abs(pair.0.g - pair.1.g), abs(pair.0.b - pair.1.b)))
            if delta > worst {
                worst = delta
                worstIndex = index
            }
        }
        XCTAssertLessThanOrEqual(
            worst, phaseTolerance,
            "At paired sample \(worstIndex + 1)/\(samples.a.count) the EARLY block was " +
                "\(hex(samples.a[worstIndex])) and the LATE block was \(hex(samples.b[worstIndex])) " +
                "— \(worst) units apart, out of a \(Self.tier2RampSpan)-unit ramp. They were " +
                "mounted 700ms apart, and ADR-8 gives every instance ONE clock with an absolute " +
                "origin, so they must be at the same phase. A renderer that starts its own sweep " +
                "from zero on mount is permanently offset by however late it mounted."
        )
    }

    /// Largest end-to-end variation any single channel showed across `samples`.
    /// Per-channel rather than per-pixel-distance because the shimmer is grey:
    /// all three channels move together, and taking the max keeps a single
    /// noisy channel from inflating the result.
    private func channelExcursion(_ samples: [RGB]) -> Int {
        guard !samples.isEmpty else { return 0 }
        let r = samples.map(\.r), g = samples.map(\.g), b = samples.map(\.b)
        return max(r.max()! - r.min()!, max(g.max()! - g.min()!, b.max()! - b.min()!))
    }
}
