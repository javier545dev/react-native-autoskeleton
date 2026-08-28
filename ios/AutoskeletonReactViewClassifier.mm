#import "AutoskeletonReactViewClassifier.h"

#import <React/RCTImageComponentView.h>
#import <React/RCTParagraphComponentView.h>
#import <React/RCTTextInputComponentView.h>
#import <React/RCTViewComponentView.h>

@implementation AutoskeletonReactViewClassifier

+ (BOOL)isParagraphComponentView:(UIView *)view {
    return [view isKindOfClass:[RCTParagraphComponentView class]];
}

+ (BOOL)isImageComponentView:(UIView *)view {
    return [view isKindOfClass:[RCTImageComponentView class]];
}

+ (BOOL)isTextInputComponentView:(UIView *)view {
    return [view isKindOfClass:[RCTTextInputComponentView class]];
}

+ (UIView *)makeContainerViewWithFrame:(CGRect)frame {
    return [[RCTViewComponentView alloc] initWithFrame:frame];
}

+ (UIView *)makeParagraphViewWithFrame:(CGRect)frame {
    return [[RCTParagraphComponentView alloc] initWithFrame:frame];
}

+ (UIView *)makeImageViewWithFrame:(CGRect)frame {
    return [[RCTImageComponentView alloc] initWithFrame:frame];
}

+ (UIView *)makeTextInputViewWithFrame:(CGRect)frame {
    return [[RCTTextInputComponentView alloc] initWithFrame:frame];
}

@end
