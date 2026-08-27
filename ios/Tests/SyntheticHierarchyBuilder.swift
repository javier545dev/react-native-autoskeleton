import Foundation

/// Task 0.4 (tasks.md Phase 0) / plan.md §7.1: test-target-only harness that will
/// instantiate real Fabric component view classes (`RCTParagraphComponentView`,
/// `RCTImageComponentView`, `RCTTextInputComponentView`, plain
/// `RCTViewComponentView` containers), attach them to a fixed-size `UIWindow`, set
/// explicit frames, and call `layoutIfNeeded()` so `convert(rect:to:)` operates on
/// genuine laid-out geometry rather than mocked values.
///
/// Deliberately empty in Phase 0 — populated in task 3.1 alongside the real iOS
/// sensor (`ios/AutoskeletonSensor.swift`) and the shared JSON fixtures under
/// `test/fixtures/hierarchies/`. Strict TDD: no logic here without a driving RED
/// test, and 3.1's `SyntheticHierarchyBuilderTests.swift` is that test.
enum SyntheticHierarchyBuilder {
    // Intentionally empty — see task 3.1.
}
