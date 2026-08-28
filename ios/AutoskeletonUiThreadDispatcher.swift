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
protocol AutoskeletonUiThreadDispatching {
    func runAndWait<T>(timeoutMs: Double, _ block: @escaping () -> T?) -> T?
}

final class AutoskeletonSystemUiThreadDispatcher: AutoskeletonUiThreadDispatching {
    func runAndWait<T>(timeoutMs: Double, _ block: @escaping () -> T?) -> T? {
        if Thread.isMainThread {
            return block()
        }
        var result: T?
        let semaphore = DispatchSemaphore(value: 0)
        DispatchQueue.main.async {
            result = block()
            semaphore.signal()
        }
        _ = semaphore.wait(timeout: .now() + .milliseconds(Int(timeoutMs)))
        return result
    }
}
