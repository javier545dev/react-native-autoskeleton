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
