// ===========================================================================
// NEW ARCHITECTURE GUARD. Deliberately the FIRST thing in this file, ahead of
// every `#import`, so that a consumer who builds autoskeleton with the old
// architecture reads the sentence below instead of
// `'react/renderer/components/AutoskeletonSpec/ComponentDescriptors.h' file
// not found` — an error that names a header nobody asked for and no cause.
//
// WHY THIS CAN HAPPEN AT ALL, verified against the actual CocoaPods scripts of
// both ends of the supported range rather than assumed. `Autoskeleton.podspec`
// ends in `install_modules_dependencies(s)`. In
// `react-native/scripts/react_native_pods.rb` that function reads:
//
//   0.77.3 / 0.81.6:  NewArchitectureHelper.install_modules_dependencies(
//                       spec, new_arch_enabled, folly_config[:version])
//   0.82.1 and later: NewArchitectureHelper.install_modules_dependencies(
//                       spec, true, folly_config[:version])
//
// and `scripts/cocoapods/new_architecture.rb`'s `computeFlags(enabled)` returns
// `-DRCT_NEW_ARCH_ENABLED=1` only when that argument is true, feeding it into
// BOTH `spec.compiler_flags` and the pod's `OTHER_CPLUSPLUSFLAGS` (present in
// 0.77.3 and 0.81.6 alike). So on 0.77-0.81 the flag genuinely tracks
// `RCT_NEW_ARCH_ENABLED` in the environment, and from 0.82 the literal `true`
// makes it unconditional. That is the whole window in which this guard can
// fire, and it matches `package.json`'s `react-native: ">=0.77.0"` floor.
//
// WHY `#error` AND NOT A SILENT NO-OP. Compiling this file into an inert stub
// under the old architecture would produce a library that links, ships, and
// then paints nothing at runtime — the exact failure mode task 5.8 was written
// to fix, rediscovered on a user's device instead of on this line. A skeleton
// library that refuses to build is strictly cheaper than one that builds and
// renders an empty screen.
//
// WHY IT CANNOT FIRE ON A CORRECT BUILD: `RCT_NEW_ARCH_ENABLED` is defined by
// RN's own podspec helper above for every New-Architecture `pod install` in
// [0.77, 0.87]; this pod calls that helper, and the only other target that
// compiles anything from `ios/` is the `Tests` test_spec, whose source_files
// are `ios/Tests/**/*.swift` — no `.mm`, so this directive is never reached
// there.
#if !defined(RCT_NEW_ARCH_ENABLED)
#error "autoskeleton is New Architecture only: this file hosts the Fabric \
component 'AutoskeletonOverlayView', and it was compiled without \
RCT_NEW_ARCH_ENABLED, which means React Native installed this pod for the OLD \
architecture. Enable the New Architecture and re-run `pod install`: unset (or \
set to 1) RCT_NEW_ARCH_ENABLED in the environment your `pod install` runs in, \
and set newArchEnabled=true in android/gradle.properties for the Android half. \
React Native 0.82 and newer turn the New Architecture on unconditionally, so \
this can only be reached on 0.77-0.81. autoskeleton refuses to build here on \
purpose: with Paper it would register no view and paint nothing at all."
#endif
// ===========================================================================

#import "AutoskeletonOverlayView.h"

#import <react/renderer/components/AutoskeletonSpec/ComponentDescriptors.h>
#import <react/renderer/components/AutoskeletonSpec/EventEmitters.h>
#import <react/renderer/components/AutoskeletonSpec/Props.h>
#import <react/renderer/components/AutoskeletonSpec/RCTComponentViewHelpers.h>

#import <React/RCTConversions.h>
#import <React/RCTFabricComponentsPlugins.h>

// Portable across both pod linkage modes, mirrors `Autoskeleton.mm`: framework
// builds (`use_frameworks!`) only expose the generated Swift header at
// `<Autoskeleton/Autoskeleton-Swift.h>`; static-library builds (this
// project's default — see `Autoskeleton.mm`'s own header comment for the
// verified reasoning) only expose it as a same-directory quoted import.
#if __has_include(<Autoskeleton/Autoskeleton-Swift.h>)
#import <Autoskeleton/Autoskeleton-Swift.h>
#else
#import "Autoskeleton-Swift.h"
#endif

using namespace facebook::react;

// Task 5.8 (tasks.md Phase 5, task 5.7 follow-up) / plan.md ADR-5, ADR-9: the
// PREVIOUSLY MISSING iOS host for the codegen'd "AutoskeletonOverlayView"
// Fabric component — the actual root cause of the on-device paint gate's RED
// state (confirmed by captured on-device screenshot evidence in the prior
// session: the sampled pixel was React Native's own "Unimplemented
// component: <AutoskeletonOverlayView>" placeholder, not raw fixture
// content — see this task's apply-progress report for the full account).
//
// DISCOVERY MECHANISM, verified empirically rather than assumed — a wrong
// first guess is documented here so it is never retried: `RCTComponentViewFactory`
// (`RCTComponentViewFactory.mm`) resolves an unregistered component name in
// order — (1) `RCTFabricComponentsProvider(name)`, which only covers RN's
// own BUILT-IN components; (2) `self.thirdPartyFabricComponentsProvider.
// thirdPartyFabricComponents[name]`, a dictionary the consumer app's
// codegen step (`generate-artifacts-executor/generateRCTThirdPartyComponents.js`)
// bakes into `RCTThirdPartyComponentsProvider.mm`. That generator populates
// the dictionary from TWO possible sources: a DEPRECATED crawl of every
// `.mm` file in the pod for a free `Class<RCTComponentViewProtocol>
// <Name>Cls(void)` function (`findRCTComponentViewProtocolClass`), or the
// non-deprecated `codegenConfig.ios.componentProvider` map in the library's
// own `package.json` — the SAME mechanism `react-native-safe-area-context`
// uses (`node_modules/react-native-safe-area-context/package.json`'s
// `codegenConfig.ios.componentProvider`, verified by reading it directly).
// The crawl path was tried FIRST in this session and does NOT fire for this
// package: `parseiOSAnnotations` (`generate-artifacts-executor/utils.js`)
// skips any library whose `codegenConfig` has no `ios` key AT ALL before it
// ever reaches the crawl fallback — confirmed by adding the crawl-target
// free function, running `pod install`, and finding
// `RCTThirdPartyComponentsProvider.mm` still had no entry. The actual fix
// is the explicit `codegenConfig.ios.componentProvider` map now in this
// package's root `package.json` (`{"AutoskeletonOverlayView":
// "AutoskeletonOverlayView"}`), confirmed by re-running `pod install` and
// grepping the regenerated provider file for the new entry.
//
// ARCHITECTURE PRECONDITION for everything above: none of that discovery
// machinery exists under the old architecture — `RCTComponentViewFactory`,
// `RCTThirdPartyComponentsProvider` and `codegenConfig.ios.componentProvider`
// are all Fabric-only. That is what the `#error` at the top of this file
// guards, and it is why the reasoning recorded here has no old-architecture
// counterpart to document: there is nothing to register with.
//
// ALL real mount/update/destroy behaviour lives in
// `AutoskeletonOverlayViewHost` (Swift, fully unit tested by
// `AutoskeletonOverlayViewHostTests`) — this class is reduced to extracting
// plain values from the codegen'd C++ `AutoskeletonOverlayViewProps` and
// forwarding them, the SAME split `Autoskeleton.mm`/`AutoskeletonModuleBridge`
// already established for the Turbo Module side (an ObjC++ class overriding
// `updateProps:oldProps:`, a method taking C++ `facebook::react` types Swift
// cannot see, has nothing left to unit test once reduced to this).
@interface AutoskeletonOverlayView () <RCTAutoskeletonOverlayViewViewProtocol>
@end

@implementation AutoskeletonOverlayView {
    AutoskeletonOverlayViewHost *_host;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
    return concreteComponentDescriptorProvider<AutoskeletonOverlayViewComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame
{
    if (self = [super initWithFrame:frame]) {
        static const auto defaultProps = std::make_shared<const AutoskeletonOverlayViewProps>();
        _props = defaultProps;
        _host = [AutoskeletonOverlayViewHost new];
    }
    return self;
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
    [super updateProps:props oldProps:oldProps];
    [self mountOrUpdate];
}

- (void)layoutSubviews
{
    [super layoutSubviews];
    // Fabric applies props before this view necessarily has a non-zero
    // `bounds` (mounting order: create -> update props -> update state ->
    // update layout metrics -> finalize update). `AutoskeletonOverlayViewHost.
    // mountOrUpdate` no-ops on a zero-sized surface, so a cache HIT that
    // arrives before layout is known would otherwise never mount at all —
    // mirrors exactly why Android's `AutoskeletonOverlayView.kt` ALSO
    // re-runs its own `mountOrUpdate()` from `onSizeChanged`, not only from
    // its `cacheKey` prop setter, and mirrors this same pod's own
    // `RNCSafeAreaProviderComponentView.mm` calling its layout-dependent
    // logic from `layoutSubviews` (verified by reading that file directly).
    [self mountOrUpdate];
}

- (void)mountOrUpdate
{
    const auto &props = *std::static_pointer_cast<AutoskeletonOverlayViewProps const>(_props);
    // BEFORE `mountOrUpdate`, never after: the host stores this value and reads
    // it when it mounts, so setting it second would mount the first frame with
    // the previous direction. `toString` is codegen's own enum->string helper,
    // the same one `animation` already goes through — the prop is
    // `WithDefault<'ltr' | 'rtl', 'ltr'>`, so an omitted prop arrives here as
    // "ltr" and every existing consumer is unchanged.
    //
    // The prop is `writingDirection` and not `direction` because Fabric's C++
    // `ViewProps` already parses a raw prop named `direction` into Yoga's
    // layout direction, whose accepted values are these very strings — see
    // `src/native/AutoskeletonOverlayNativeComponent.ts` for the full account.
    [_host setDirection:RCTNSStringFromString(toString(props.writingDirection))];
    [_host mountOrUpdateWithCacheKey:RCTNSStringFromString(props.cacheKey)
                            baseColor:RCTNSStringFromString(props.baseColor)
                       highlightColor:RCTNSStringFromString(props.highlightColor)
                        defaultRadius:props.defaultRadius
                              speedMs:props.speedMs
                            animation:RCTNSStringFromString(toString(props.animation))
                        reducedMotion:props.reducedMotion
                         debugOverlay:props.debugOverlay
                              surface:self];
}

- (void)prepareForRecycle
{
    [_host destroy];
    [super prepareForRecycle];
}

@end
