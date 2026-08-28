#import <React/RCTViewComponentView.h>

NS_ASSUME_NONNULL_BEGIN

// Task 5.8 (tasks.md Phase 5, task 5.7 follow-up) / plan.md ADR-5, ADR-9: the
// iOS `RCTViewComponentView` subclass Fabric mounts for the codegen'd
// "AutoskeletonOverlayView" component (`src/native/AutoskeletonOverlayNativeComponent.ts`).
// Fabric discovers this class by CONVENTION — see `AutoskeletonOverlayView.mm`'s
// header comment for exactly how — not by any explicit registration call a
// consumer app makes. All real mount/update/destroy behaviour lives in the
// Swift-testable `AutoskeletonOverlayViewHost`; this class is thin ObjC++
// glue extracting plain values from the codegen'd C++ props.
@interface AutoskeletonOverlayView : RCTViewComponentView

@end

NS_ASSUME_NONNULL_END
