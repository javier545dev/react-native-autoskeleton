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
        let result = dispatcher.runAndWait(timeoutMs: 200) { "value" }
        XCTAssertEqual(result, "value")
    }

    func testRunAndWaitPropagatesANilBlockResult() {
        let dispatcher = AutoskeletonSystemUiThreadDispatcher()
        let result: String? = dispatcher.runAndWait(timeoutMs: 200) { nil }
        XCTAssertNil(result)
    }

    func testRunAndWaitDispatchesToTheRealMainThreadWhenCalledFromABackgroundThread() {
        let dispatcher = AutoskeletonSystemUiThreadDispatcher()
        let expectation = expectation(description: "background dispatch completes")
        var observedOnMainThread = false

        DispatchQueue.global(qos: .userInitiated).async {
            let result: Bool? = dispatcher.runAndWait(timeoutMs: 1000) {
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
            let result: String? = dispatcher.runAndWait(timeoutMs: 50) { "unreachable" }
            elapsedMs = Date().timeIntervalSince(startedAt) * 1000
            XCTAssertNil(result)
            expectation.fulfill()
        }

        wait(for: [expectation], timeout: 3)
        XCTAssertLessThan(elapsedMs, 1000, "waited far longer than the requested timeout")
    }
}
