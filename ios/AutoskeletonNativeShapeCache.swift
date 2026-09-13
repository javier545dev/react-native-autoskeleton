import Foundation

// Task 5.2 (tasks.md Phase 5) / plan.md ADR-9: native-side shape-DATA
// authority, keyed by the same composite cache-key string JS uses. Written
// ONLY when `getShapes()` (task 5.1) runs a real traversal it was asked
// for — never speculatively. Evicted when JS explicitly requests it via
// `evictShapes` (mirroring `store.invalidate(...)` -> native `evict(keys)`),
// which is what keeps this cache and the JS `ShapeStore` from ever diverging
// (ADR-9's explicit consequence), AND by its own size bound below.
//
// The bound is not belt-and-braces, it is the only thing removing anything.
// This header used to say "Evicted ONLY when JS explicitly requests it", and
// that wiring does not exist: `evictNativeShapes` in
// `src/native/wire-bridge.ts` has no call site anywhere in `src/`, and
// `store.invalidate()` is never called either, on any platform. So this
// shared singleton only ever grew — one more wire array per distinct
// `cacheKey` (a new screen, a new list item type, a rotation into a different
// width bucket), each outliving the view it described, none ever removed. A
// bound is what makes the word "cache" true.
//
// A plain `NSLock`-guarded dictionary: `getShapes`/`evictShapes` are both
// invoked on the JS thread synchronously (Turbo Module methods), but a
// lock is cheap insurance against a future caller on another thread and
// costs nothing on the hot (uncontended) path.
final class AutoskeletonNativeShapeCache {
    static let shared = AutoskeletonNativeShapeCache()

    /// At `maxShapes` = 60 an entry is `1 + 5 * 60` doubles, about 2.4 KB, so
    /// this bounds the cache near 600 KB — room for far more distinct keys
    /// than any one screen produces, and a ceiling instead of a slope.
    /// Deliberately the same value in `AutoskeletonNativeShapeCache.kt`.
    static let maxEntries = 256

    private var storage: [String: [Double]] = [:]
    /// Least-recently-USED order, oldest first. Swift has no access-ordered
    /// dictionary, so the order is kept beside the storage rather than in it.
    /// Used, not merely inserted: the overlay reads the entry it is painting
    /// on every frame, so an insertion-ordered bound would evict exactly the
    /// entry still on screen whenever a screen keeps measuring new keys.
    ///
    /// A plain array rather than a linked list: at 256 entries the `remove`
    /// scan is far cheaper than the allocation a node-based list would cost,
    /// and this is not a per-frame path.
    private var usageOrder: [String] = []
    private let lock = NSLock()

    /// Caller MUST hold `lock`.
    private func touch(_ cacheKey: String) {
        if let existing = usageOrder.firstIndex(of: cacheKey) {
            usageOrder.remove(at: existing)
        }
        usageOrder.append(cacheKey)
    }

    func set(_ cacheKey: String, _ wire: [Double]) {
        lock.lock()
        defer { lock.unlock() }
        storage[cacheKey] = wire
        touch(cacheKey)
        while usageOrder.count > Self.maxEntries {
            storage.removeValue(forKey: usageOrder.removeFirst())
        }
    }

    func get(_ cacheKey: String) -> [Double]? {
        lock.lock()
        defer { lock.unlock() }
        guard let wire = storage[cacheKey] else {
            return nil
        }
        touch(cacheKey)
        return wire
    }

    func evict(_ cacheKeys: [String]) {
        lock.lock()
        defer { lock.unlock() }
        for key in cacheKeys {
            storage.removeValue(forKey: key)
        }
        usageOrder.removeAll { cacheKeys.contains($0) }
    }

    /// Test-only full reset.
    func clear() {
        lock.lock()
        defer { lock.unlock() }
        storage.removeAll()
        usageOrder.removeAll()
    }

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return storage.count
    }
}
