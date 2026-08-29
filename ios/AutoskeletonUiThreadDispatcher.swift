import Foundation

// Visual-paint-gate remediation (tasks.md Phase 5 follow-up) / ADR-1: mirrors
// Android's `AutoskeletonUiThreadDispatcher` (`android/.../AutoskeletonModule.kt`).
// `getShapes()` is a SYNCHRONOUS Turbo Module method invoked on the JS thread,
// but resolving a `UIView` via `RCTViewRegistry.viewForReactTag(_:)` and reading
// UIKit geometry must happen on the MAIN thread (UIKit is not thread-safe) —
// the exact same class of bug the Android side had, confirmed there via a real
// device test before this Swift counterpart was written defensively rather than
// discovered the same expensive way twice. `DispatchQueue.main.sync` deadlocks
// if called FROM the main thread, so this checks `Thread.isMainThread` first
// (mirrors `UiThreadUtil.isOnUiThread()`'s fast path) and bounds the wait so a
// stuck main thread degrades to `nil` instead of hanging the JS thread forever.
//
// Kept Swift-internal and generic (`<T>`) — Swift generics do not cross the
// Objective-C boundary, so `Autoskeleton.mm` never references this type
// directly. `AutoskeletonModuleBridge`'s `@objc`-exposed methods use this
// internally and expose only concrete, ObjC-bridgeable types at their own
// boundary (see `AutoskeletonModuleBridge.swift`).
//
// Adversarial-review defect (2026-08-28), THREE distinct problems fixed
// together (mirrors Android's `AutoskeletonUiThreadDispatcher.kt` fix):
// 1. `semaphore.wait(timeout:)`'s `DispatchTimeoutResult` (`.success` vs
//    `.timedOut`) used to be discarded entirely (`_ = semaphore.wait(...)`)
//    — the caller had no way to distinguish the two outcomes. Now used
//    directly to decide the return value.
// 2. The block dispatched via `DispatchQueue.main.async` is NEVER
//    cancellable once queued (GCD exposes no handle for it) — it keeps
//    running after the caller times out and moves on. `block` used to run
//    to completion regardless, including its own shared-state writes
//    (`AutoskeletonModuleBridge.computeWireArray`'s `shapeCache.set`),
//    writing stale geometry into the shared cache for a `cacheKey` that, on
//    a recycled list, may by then belong to a different row. Since the
//    dispatched block itself cannot be forcibly cancelled, it now receives
//    a cooperative `isCancelled: () -> Bool` check it MUST consult before
//    any observable side effect — see `computeWireArray`'s own guard.
// 3. `result` was a plain `var`, captured by an `@escaping` closure and
//    written on the main thread, then read on the calling thread with NO
//    explicit synchronization — the same class of data race Android's
//    non-`@Volatile` `var` had, just without a language keyword to flag it.
//    Replaced with `LockedBox`, an `NSLock`-guarded box, for both the
//    result and the cancellation flag — explicit, unambiguous
//    cross-thread safety rather than relying on `DispatchSemaphore`'s
//    (undocumented, if generally relied-upon) implicit memory barrier.
protocol AutoskeletonUiThreadDispatching {
    func runAndWait<T>(timeoutMs: Double, _ block: @escaping (_ isCancelled: @escaping () -> Bool) -> T?) -> T?
}

/// `NSLock`-guarded mutable box — the explicit cross-thread synchronization
/// primitive `runAndWait` uses for both its result and cancellation flag
/// (see this file's header comment, problem 3). `internal` (default access)
/// is sufficient: only `AutoskeletonSystemUiThreadDispatcher` and its
/// `@testable`-imported test suite need it.
final class LockedBox<T> {
    private let lock = NSLock()
    private var _value: T

    init(_ value: T) {
        self._value = value
    }

    var value: T {
        get {
            lock.lock()
            defer { lock.unlock() }
            return _value
        }
        set {
            lock.lock()
            defer { lock.unlock() }
            _value = newValue
        }
    }
}

final class AutoskeletonSystemUiThreadDispatcher: AutoskeletonUiThreadDispatching {
    func runAndWait<T>(timeoutMs: Double, _ block: @escaping (_ isCancelled: @escaping () -> Bool) -> T?) -> T? {
        if Thread.isMainThread {
            return block({ false })
        }
        let resultBox = LockedBox<T?>(nil)
        let timedOutBox = LockedBox<Bool>(false)
        let semaphore = DispatchSemaphore(value: 0)
        DispatchQueue.main.async {
            resultBox.value = block({ timedOutBox.value })
            semaphore.signal()
        }
        let waitResult = semaphore.wait(timeout: .now() + .milliseconds(Int(timeoutMs)))
        guard waitResult == .success else {
            timedOutBox.value = true
            return nil
        }
        return resultBox.value
    }
}
