#import "Autoskeleton.h"
// Portable across both pod linkage modes: framework builds (`use_frameworks!`)
// only expose the generated Swift header at `<Autoskeleton/Autoskeleton-Swift.h>`;
// static-library builds only expose it as a same-directory quoted import.
#if __has_include(<Autoskeleton/Autoskeleton-Swift.h>)
#import <Autoskeleton/Autoskeleton-Swift.h>
#else
#import "Autoskeleton-Swift.h"
#endif

// Task 5.1 (tasks.md Phase 5) / plan.md ADR-1: `getShapes`/`evictShapes`,
// now wired to the real `AutoskeletonModuleBridge` (Swift).
//
// HISTORY, corrected: an earlier session's investigation concluded this
// `#import "Autoskeleton-Swift.h"` line itself triggered a "reproducible
// Xcode New Build System issue" and left `getShapes`/`evictShapes` as
// no-op stubs rather than risk the passing 55/55 iOS baseline. This
// session re-tested that claim directly, per the maintainer's explicit
// instruction to exhaust configuration before redesigning: a full
// `rm -rf ~/Library/Developer/Xcode/DerivedData/AutoskeletonBareRn-*`
// followed by `xcodebuild -workspace AutoskeletonBareRn.xcworkspace
// -scheme Autoskeleton-Unit-Tests -sdk iphonesimulator build` with this
// EXACT import present compiled `Autoskeleton.mm` cleanly for both
// arm64 and x86_64 (`CompileC ... Autoskeleton.mm ... objective-c++`,
// zero errors, `** BUILD SUCCEEDED **`) against the project's actual
// pod configuration: `use_frameworks!` is NOT enabled in
// `examples/bare-rn/ios/Podfile` (only `ENV['USE_FRAMEWORKS']`-gated),
// so `Autoskeleton` builds as a plain static-library pod — CocoaPods
// still emits a real `Autoskeleton-Swift.h` for a static-library pod
// containing Swift sources (`DEFINES_MODULE=YES` is not
// framework-exclusive), contradicting the earlier session's premise
// that "a pod containing Swift ALWAYS builds as a framework". The
// import resolves and the build is clean with no configuration change
// beyond what was already in place. No workaround, hand-rolled
// protocol registry, or Nitro reopening was needed.
//
// View resolution: `viewRegistry_DEPRECATED` (`Autoskeleton.h`) is RN's
// own documented mechanism for a Turbo Module to resolve a `UIView` by
// React tag. It is kept HERE in Objective-C++ (never exposed to Swift
// directly, which would need an additional cross-pod Swift module
// import for `RCTViewRegistry`) and passed into
// `AutoskeletonModuleBridge` as a resolver block. Reading UIKit state
// must happen on the main thread — the exact same class of defect the
// Android side had (confirmed there via a real device test before this
// Swift/ObjC++ counterpart was written defensively) — so
// `AutoskeletonModuleBridge` runs the resolution + measurement as one
// unit through its own `AutoskeletonUiThreadDispatching` (mirrors
// Android's `AutoskeletonUiThreadDispatcher`).

@implementation Autoskeleton {
    AutoskeletonModuleBridge *_bridge;
}

- (instancetype)init
{
    if (self = [super init]) {
        _bridge = [[AutoskeletonModuleBridge alloc] init];
    }
    return self;
}

- (NSArray<NSNumber *> *)getShapes:(double)reactTag cacheKey:(NSString *)cacheKey {
    __weak Autoskeleton *weakSelf = self;
    return [self->_bridge getShapesWithReactTag:@(reactTag)
                                        cacheKey:cacheKey
                                     resolveView:^UIView * _Nullable(NSNumber * _Nonnull tag) {
        Autoskeleton *strongSelf = weakSelf;
        return [strongSelf.viewRegistry_DEPRECATED viewForReactTag:tag];
    }];
}

- (void)evictShapes:(NSArray *)cacheKeys {
    NSMutableArray<NSString *> *keys = [NSMutableArray arrayWithCapacity:cacheKeys.count];
    for (id key in cacheKeys) {
        if ([key isKindOfClass:[NSString class]]) {
            [keys addObject:(NSString *)key];
        }
    }
    [self->_bridge evictShapesDispatched:keys];
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
