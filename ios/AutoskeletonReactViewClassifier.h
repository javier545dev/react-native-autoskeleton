#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Task 3.1 (tasks.md Phase 3): the `Autoskeleton` CocoaPods pod builds as a
 * FRAMEWORK product (any pod containing Swift sources does), and Xcode/Swift
 * disallows bridging headers for framework-type targets ("using bridging headers
 * with framework targets is unsupported"). `React.framework`'s Fabric leaf
 * component-view classes (`RCTParagraphComponentView`, `RCTImageComponentView`,
 * `RCTTextInputComponentView`) are genuinely public headers but are marked
 * `textual header` (or absent entirely) in `React.framework`'s module map, so they
 * are not visible to a plain Swift `import React` either.
 *
 * This tiny Objective-C++ shim is the standard, working escape hatch: it lives in
 * THIS SAME pod target, so `AutoskeletonSensor.swift` sees it automatically
 * (Swift/Objective-C files within one target interop without any bridging header —
 * that mechanism exists only for headers OUTSIDE the current target). Its `.mm`
 * implementation file `#import`s the React headers directly, which is a fully
 * ordinary Objective-C++ textual include with none of Swift's restrictions
 * (`.mm`, not `.m`, because those headers transitively need `<atomic>` and other
 * C++ standard headers only available in Objective-C++ compilation mode).
 *
 * The `make*ViewWithFrame:` factory methods exist for the SAME reason, for the
 * test-only `SyntheticHierarchyBuilder.swift`: `Autoskeleton-Unit-Tests` is a
 * unit-test BUNDLE product (not a framework), so a Swift bridging header would be
 * legal there in principle, but pulling React's C++-heavy headers through Swift's
 * bridging-header dependency scanner hits the same `<atomic>`-not-found failure
 * class regardless of `.m`/`.mm` — bridging-header scanning has no per-file
 * language-mode override. Routing construction through this already-public,
 * already-working Objective-C++ shim sidesteps that entirely.
 */
@interface AutoskeletonReactViewClassifier : NSObject

+ (BOOL)isParagraphComponentView:(UIView *)view;
+ (BOOL)isImageComponentView:(UIView *)view;
+ (BOOL)isTextInputComponentView:(UIView *)view;

+ (UIView *)makeContainerViewWithFrame:(CGRect)frame;
+ (UIView *)makeParagraphViewWithFrame:(CGRect)frame;
+ (UIView *)makeImageViewWithFrame:(CGRect)frame;
+ (UIView *)makeTextInputViewWithFrame:(CGRect)frame;

@end

NS_ASSUME_NONNULL_END
