#import <AutoskeletonSpec/AutoskeletonSpec.h>
#import <React/RCTBridgeModule.h>

@interface Autoskeleton : NSObject <NativeAutoskeletonSpec>

// Visual-paint-gate remediation: RN's documented mechanism for a Turbo
// Module to resolve a `UIView` by React tag (`RCTBridgeModule.h`: "Useful
// for modules that query UIViews"). Redeclared here (not merely inherited
// from the `<NativeAutoskeletonSpec>` protocol, which only forward-declares
// it) so Xcode auto-synthesizes real backing storage for this class —
// without a redeclaration in this class's own `@interface`, `self.
// viewRegistry_DEPRECATED` has no synthesized ivar to read from.
@property (nonatomic, weak, readwrite) RCTViewRegistry *viewRegistry_DEPRECATED;

@end
