#import "Autoskeleton.h"

// Task 5.1 (tasks.md Phase 5) / plan.md ADR-1: `getShapes`/`evictShapes`.
//
// KNOWN GAP, stated honestly rather than silently shipped: the real
// measure/encode/cache logic lives in `AutoskeletonModuleBridge.swift` +
// `AutoskeletonSensor.swift` (already implemented and covered by
// `AutoskeletonModuleBridgeTests.swift`, a pure Swift-to-Swift XCTest
// suite with no ObjC boundary). Wiring THIS file to call it requires
// `#import "Autoskeleton-Swift.h"` (the CocoaPods-generated Swift
// compatibility header for this same pod target) — every attempt this
// session hit a reproducible Xcode New Build System issue where a clean
// build's `.mm` compile step ran against an incomplete/stale
// `Autoskeleton-Swift.h` that did not yet declare newly-added Swift
// classes, even after a full `rm -rf DerivedData` + rebuild (ruling out
// simple incremental-cache staleness). Investigated: build log ordering
// of `SwiftEmitModule` vs. the `.mm` `CompileC` step, `-experimental-
// emit-module-separately`, multiple clean rebuilds — same failure every
// time. Rather than ship an unverified guess at a toolchain fix, or leave
// the whole example app non-building (violating "do not weaken an
// existing assertion" / the 46/46 iOS baseline), `getShapes`/`evictShapes`
// return an empty/no-op result here — compiles cleanly, satisfies the
// codegen'd protocol, does not crash — until this Swift/ObjC++ interop
// issue is resolved in a follow-up session. Tracked as a known limitation
// in the apply-progress artifact.

@implementation Autoskeleton

- (NSArray<NSNumber *> *)getShapes:(double)reactTag cacheKey:(NSString *)cacheKey {
    return @[];
}

- (void)evictShapes:(NSArray *)cacheKeys {
    // no-op until the Swift bridge wiring above is resolved.
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
    return std::make_shared<facebook::react::NativeAutoskeletonSpecJSI>(params);
}

+ (NSString *)moduleName
{
  return @"Autoskeleton";
}

@end
