@testable import Autoskeleton
import Foundation
import XCTest

/// Visual-paint-gate remediation (tasks.md Phase 5 follow-up) / ADR-1: mirrors
/// Android's `AutoskeletonUiThreadDispatcherTest.kt`. `getShapes()` is a
/// synchronous Turbo Module method invoked on the JS thread; resolving a
/// `UIView` and reading UIKit geometry must happen on the main thread.
final class AutoskeletonUiThreadDispatcherTests: XCTestCase {
    func testRunAndWaitReturnsTheBlockResultWhenAlreadyOnTheMainThread() {
        let dispatcher = AutoskeletonSystemUiThreadDispatcher()
        let result = dispatcher.runAndWait(timeoutMs: 200) { _ in "value" }
        XCTAssertEqual(result, "value")
    }

    func testRunAndWaitPropagatesANilBlockResult() {
        let dispatcher = AutoskeletonSystemUiThreadDispatcher()
        let result: String? = dispatcher.runAndWait(timeoutMs: 200) { _ in nil }
        XCTAssertNil(result)
    }

    func testRunAndWaitDispatchesToTheRealMainThreadWhenCalledFromABackgroundThread() {
        let dispatcher = AutoskeletonSystemUiThreadDispatcher()
        let expectation = expectation(description: "background dispatch completes")
        var observedOnMainThread = false

        DispatchQueue.global(qos: .userInitiated).async {
            let result: Bool? = dispatcher.runAndWait(timeoutMs: 1000) { _ in
                Thread.isMainThread
            }
            observedOnMainThread = result == true
            expectation.fulfill()
        }

        wait(for: [expectation], timeout: 2)
        XCTAssertTrue(observedOnMainThread, "block did not observe the main thread")
    }

    func testRunAndWaitReturnsNilRatherThanHangingForeverOnTimeout() {
        // A block that never completes (simulates a permanently busy main
        // thread) must still return within the requested timeout, not hang
        // the calling (JS) thread indefinitely.
        let dispatcher = AutoskeletonSystemUiThreadDispatcher()
        let expectation = expectation(description: "background call returns")
        var elapsedMs: Double = -1

        DispatchQueue.global(qos: .userInitiated).async {
            let startedAt = Date()
            // Block the main thread's queue with a long-running task so the
            // dispatched block genuinely cannot complete within the timeout.
            DispatchQueue.main.async { Thread.sleep(forTimeInterval: 2) }
            let result: String? = dispatcher.runAndWait(timeoutMs: 50) { _ in "unreachable" }
            elapsedMs = Date().timeIntervalSince(startedAt) * 1000
            XCTAssertNil(result)
            expectation.fulfill()
        }

        wait(for: [expectation], timeout: 3)
        XCTAssertLessThan(elapsedMs, 1000, "waited far longer than the requested timeout")
    }

    // Adversarial-review defect (2026-08-28): the test above only ever
    // asserted what the CALLER observes (a prompt `nil`). It never waited
    // long enough afterward for the ABANDONED async block to actually run
    // -- so nothing in this suite ever caught that `semaphore.wait(...)`'s
    // return value was discarded, the dispatched block was never told the
    // caller gave up, and `result` was a plain `var` written on the main
    // thread and read on the caller's thread with no explicit
    // synchronization. This is that missing coverage: it proves the block
    // DOES still run (GCD gives no handle to cancel an already-dispatched
    // async block), but now gets told it was abandoned via a cooperative
    // `isCancelled` check it can consult before doing anything observable
    // (e.g. a cache write) -- see `AutoskeletonModuleBridge.computeWireArray`'s
    // own guard for the production consequence.
    func testRunAndWaitLetsAnAbandonedBlockObserveCancellationOnceItFinallyRuns() {
        let dispatcher = AutoskeletonSystemUiThreadDispatcher()
        let blockRan = expectation(description: "abandoned block eventually runs")
        let observedCancelled = LockedBox<Bool?>(nil)

        DispatchQueue.global(qos: .userInitiated).async {
            // Keep the main queue busy well past the dispatcher's timeout,
            // so the dispatched block cannot run until this drains.
            DispatchQueue.main.async { Thread.sleep(forTimeInterval: 0.3) }
            let result: String? = dispatcher.runAndWait(timeoutMs: 50) { isCancelled in
                observedCancelled.value = isCancelled()
                blockRan.fulfill()
                return "too-late"
            }
            XCTAssertNil(result, "the caller must have already timed out")
        }

        wait(for: [blockRan], timeout: 2)
        XCTAssertEqual(observedCancelled.value, true, "the abandoned block must observe that its caller already timed out")
    }

    func testRunAndWaitReportsIsCancelledFalseWhenTheBlockCompletesWithinTheTimeout() {
        // Negative control: the happy path must never report a
        // false-positive cancellation.
        let dispatcher = AutoskeletonSystemUiThreadDispatcher()
        let observedCancelled = LockedBox<Bool?>(nil)

        let result = dispatcher.runAndWait(timeoutMs: 200) { isCancelled in
            observedCancelled.value = isCancelled()
            return "value"
        }

        XCTAssertEqual(result, "value")
        XCTAssertEqual(observedCancelled.value, false)
    }
}
