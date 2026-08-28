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
  s.private_header_files = "ios/Autoskeleton.h"

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
