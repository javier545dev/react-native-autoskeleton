import Foundation
import QuartzCore

// Task 3.2 (tasks.md Phase 3) / plan.md §3.6, ADR-8: Swift mirror of the TS
// `ShimmerClock` contract (`src/core/contracts.ts`). ADR-8's whole point is "phase
// derived from an absolute origin, never from per-frame ticks" — every renderer
// instance reads the SAME `startedAt` epoch-ms origin and configures its own
// CoreAnimation `beginTime` from `phaseOffsetMs`, so every shape and every list cell
// stays in phase with zero cross-instance coordination and zero JS/native per-frame
// work on the production path.

/// Normalized shimmer phase in [0, 1). Mirrors `ClockPhase` in `src/core/contracts.ts`.
typealias AutoskeletonClockPhase = Double

protocol AutoskeletonClockTicking {
    /// `preferredFrameRateRange` for 120 Hz ProMotion (brief §4 "Shared shimmer
    /// clock"). NOTE: this does NOT drive the production shimmer animation itself —
    /// see `AutoskeletonShimmerClock`'s doc comment for why that must stay a pure
    /// `CABasicAnimation` instead. This display link exists only to (a) declare
    /// frame-rate intent for the display and (b) drive `subscribe()` callbacks,
    /// which the TS contract itself scopes to "DEV/DEBUG AND TESTS ONLY".
    func start(target: Any, selector: Selector)
    func stop()
}

/// Production `CADisplayLink`-backed ticker.
final class AutoskeletonDisplayLinkTicking: AutoskeletonClockTicking {
    private var displayLink: CADisplayLink?

    func start(target: Any, selector: Selector) {
        guard let target = target as? NSObject else { return }
        let link = CADisplayLink(target: target, selector: selector)
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    func stop() {
        displayLink?.invalidate()
        displayLink = nil
    }
}

/// One shared origin every `AutoskeletonRendererTier1` instance reads (ADR-8).
/// `driver` is always `"core-animation"` on iOS tier-1 — the mask/gradient shimmer
/// is a `CABasicAnimation` configured once at mount with a `beginTime` derived from
/// `phaseOffsetMs(now:)`, so it keeps animating even if the main run loop (and this
/// clock's own optional `CADisplayLink`) were starved. That decoupling is exactly
/// what makes NFR-2 (shimmer survives a blocked JS thread) true by construction
/// rather than by luck.
final class AutoskeletonShimmerClock: NSObject {
    let id: String
    let driver = "core-animation"
    private(set) var periodMs: Double
    private(set) var startedAt: Double
    private(set) var isPaused = false

    private let ticking: AutoskeletonClockTicking
    private let now: () -> Double
    private var subscribers: [UUID: (AutoskeletonClockPhase, Double) -> Void] = [:]
    private var isTicking = false

    init(
        id: String = UUID().uuidString,
        periodMs: Double = 1500,
        ticking: AutoskeletonClockTicking = AutoskeletonDisplayLinkTicking(),
        now: @escaping () -> Double = { Date().timeIntervalSince1970 * 1000 }
    ) {
        self.id = id
        self.periodMs = periodMs
        self.ticking = ticking
        self.now = now
        startedAt = now()
    }

    /// Pure function of time — used by renderers at mount and directly by tests.
    func phaseAt(_ timestampMs: Double) -> AutoskeletonClockPhase {
        let elapsed = timestampMs - startedAt
        let wrapped = elapsed.truncatingRemainder(dividingBy: periodMs)
        return (wrapped < 0 ? wrapped + periodMs : wrapped) / periodMs
    }

    /// Negative `beginTime` offset (in seconds, matching `CAMediaTiming`'s unit) a
    /// joining renderer uses so its `CABasicAnimation` starts already in phase with
    /// every other instance, instead of restarting the sweep from zero.
    func phaseOffsetMs(now nowMs: Double) -> Double {
        let elapsed = (nowMs - startedAt).truncatingRemainder(dividingBy: periodMs)
        return -(elapsed < 0 ? elapsed + periodMs : elapsed)
    }

    func setPeriod(_ ms: Double) {
        periodMs = ms
    }

    func pause() {
        isPaused = true
    }

    func resume() {
        isPaused = false
    }

    /// DEV/DEBUG AND TESTS ONLY per the TS contract — production rendering never
    /// ticks through this. Starts the display-link ticker lazily on first
    /// subscriber, stops it once the last one unsubscribes.
    func subscribe(_ listener: @escaping (AutoskeletonClockPhase, Double) -> Void) -> () -> Void {
        let token = UUID()
        subscribers[token] = listener
        if !isTicking {
            isTicking = true
            ticking.start(target: self, selector: #selector(handleTick))
        }
        return { [weak self] in
            self?.subscribers[token] = nil
            if self?.subscribers.isEmpty == true {
                self?.isTicking = false
                self?.ticking.stop()
            }
        }
    }

    @objc private func handleTick() {
        guard !isPaused else { return }
        let t = now()
        let phase = phaseAt(t)
        for listener in subscribers.values {
            listener(phase, t)
        }
    }
}
