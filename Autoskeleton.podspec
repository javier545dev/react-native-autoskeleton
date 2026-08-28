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
  s.exclude_files = "ios/Tests/**/*"
  s.private_header_files = "ios/**/*.h"

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
