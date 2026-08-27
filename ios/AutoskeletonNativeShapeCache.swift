import Foundation

// Task 5.2 (tasks.md Phase 5) / plan.md ADR-9: native-side shape-DATA
// authority, keyed by the same composite cache-key string JS uses. Written
// ONLY when `getShapes()` (task 5.1) runs a real traversal it was asked
// for — never speculatively. Evicted ONLY when JS explicitly requests it
// via `evictShapes` (mirroring `store.invalidate(...)` -> native
// `evict(keys)`), which is what keeps this cache and the JS `ShapeStore`
// from ever diverging (ADR-9's explicit consequence).
//
// A plain `NSLock`-guarded dictionary: `getShapes`/`evictShapes` are both
// invoked on the JS thread synchronously (Turbo Module methods), but a
// lock is cheap insurance against a future caller on another thread and
// costs nothing on the hot (uncontended) path.
final class AutoskeletonNativeShapeCache {
    static let shared = AutoskeletonNativeShapeCache()

    private var storage: [String: [Double]] = [:]
    private let lock = NSLock()

    func set(_ cacheKey: String, _ wire: [Double]) {
        lock.lock()
        defer { lock.unlock() }
        storage[cacheKey] = wire
    }

    func get(_ cacheKey: String) -> [Double]? {
        lock.lock()
        defer { lock.unlock() }
        return storage[cacheKey]
    }

    func evict(_ cacheKeys: [String]) {
        lock.lock()
        defer { lock.unlock() }
        for key in cacheKeys {
            storage.removeValue(forKey: key)
        }
    }

    /// Test-only full reset.
    func clear() {
        lock.lock()
        defer { lock.unlock() }
        storage.removeAll()
    }

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return storage.count
    }
}
