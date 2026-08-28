require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "Autoskeleton"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/javier545dev/react-native-autoskeleton.git", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift,cpp}"
  # `ios/generated/` and `ios/build/` are local build/codegen output directories, never
  # source. Excluding them is load-bearing, not cosmetic: a stale `ios/generated/**`
  # left over from a prior codegen run previously matched the source_files glob above
  # and shipped a second copy of the codegen'd Turbo Module spec sources alongside the
  # real ones `ReactCodegen` generates fresh on every `pod install`, producing duplicate
  # Objective-C symbols at link time (task 3.0, Phase 3 hard prerequisite).
  s.exclude_files = ["ios/Tests/**/*", "ios/generated/**/*", "ios/build/**/*"]
  # Task 3.1 (tasks.md Phase 3): `AutoskeletonReactViewClassifier.h` is deliberately
  # NOT listed here — it must stay PUBLIC so CocoaPods includes it in this
  # framework pod's auto-generated umbrella header, which is what makes it visible
  # to `AutoskeletonSensor.swift` with no import statement at all (framework-target
  # Swift files only auto-see headers reachable through the umbrella header; a
  # `private_header_files` match would hide it and silently break that visibility —
  # see `AutoskeletonReactViewClassifier.h`'s doc comment for the full reasoning).
  #
  # Task 5.8 (tasks.md Phase 5, task 5.7 follow-up): `AutoskeletonOverlayView.h`
  # is listed here for the OPPOSITE reason `Autoskeleton.h` already was — both
  # transitively pull in genuinely C++ RN Fabric headers (this one via its
  # `RCTViewComponentView` superclass, which itself #includes
  # `react/renderer/core/EventBeat.h`, which #includes the C++ standard
  # library `<atomic>`). When such a header is left PUBLIC, CocoaPods folds
  # it into this pod's auto-generated umbrella header, which Xcode also
  # compiles to build the synthesized Clang module Swift uses to see this
  # pod's Objective-C/C++ surface — and that module compilation does not
  # resolve `<atomic>`, failing the ENTIRE Swift target with "could not
  # build module 'Autoskeleton'" (confirmed empirically this session: adding
  # `AutoskeletonOverlayView.h` without this line broke Swift compilation
  # immediately, and removing it here fixed the same build with no other
  # change). Kept private exactly like `Autoskeleton.h`, for the same reason.
  s.private_header_files = ["ios/Autoskeleton.h", "ios/AutoskeletonOverlayView.h"]

  # Visual-paint-gate remediation: the ROOT CAUSE of the previously-documented
  # "Swift/ObjC++ interop" build issue, found via direct inspection
  # (`xcodebuild -project Pods/Pods.xcodeproj -target Autoskeleton
  # -showBuildSettings`) rather than assumed: with `use_frameworks!` NOT
  # enabled (the default for this project — verified in
  # `examples/bare-rn/ios/Podfile`), this pod builds as a plain STATIC
  # LIBRARY (`MACH_O_TYPE = staticlib`), and CocoaPods does NOT
  # automatically set `DEFINES_MODULE = YES` for a static-library pod
  # target just because it contains Swift sources — it defaulted to
  # `DEFINES_MODULE = NO`. Without it, Xcode's build graph does not treat
  # the Swift-generated `Autoskeleton-Swift.h` as a proper dependency of
  # `.mm` files that `#import` it, so a `.mm` compile can run against an
  # incomplete/empty snapshot of that header even on a clean build —
  # exactly the previously-reported symptom. `DEFINES_MODULE = YES` is the
  # standard, documented CocoaPods fix for a static-library pod mixing
  # Swift and Objective-C++: it gives the target a real Clang module map,
  # which is what makes the generated header a real, correctly-ordered
  # build dependency. This is a pod CONFIGURATION fix, not a code
  # workaround, hand-rolled protocol registry, or a reason to reopen ADR-1.
  s.pod_target_xcconfig = {
    "DEFINES_MODULE" => "YES",
  }

  # Task 0.4 (tasks.md Phase 0): the XCTest target that plan.md §7.1's
  # SyntheticHierarchyBuilder harness runs under. `pod install` (triggered by the
  # bare RN example app, task 0.7) generates this as a real Xcode test target;
  # `xcodebuild test -scheme Autoskeleton-Unit-Tests` (or the umbrella app scheme)
  # runs it.
  s.test_spec "Tests" do |test_spec|
    test_spec.source_files = "ios/Tests/**/*.swift"
  end

  install_modules_dependencies(s)
end
