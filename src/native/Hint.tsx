// src/native/Hint.tsx
//
// `<AutoSkeleton.Hint>` — the native half of the typed-hint channel (spec
// §1.9/§8, plan.md ADR-2 R0). Extracted into its own small module, same
// rationale as `Ignore.tsx`: stays unit-testable with only `react` and
// `core/hint-registry.ts` imports, no `react-native` mock needed.
//
// API: typed props ONLY (`id`, `lines`, `radius`), matching REQ-THEME-3's
// "hints via typed props, never className parsing". `id` is required and
// developer-supplied (a plain string, not auto-generated via `useId()`):
// `Hint` is a deliberately hookless, plain function — exactly like `Ignore`
// — so it stays directly callable/testable without a React renderer. An
// auto-generated id would require a hook (`useId()`), which would force
// `Hint` to be RENDERED rather than called, breaking that testability. A
// developer-supplied `id` is also more debuggable (it is what
// `radiusSourceHistogram`/debug-overlay rung badges implicitly key off) and
// matches the "typed props" ethos already established for `lines`/`radius`
// themselves.
//
// MECHANISM, structurally identical to `Ignore`: `React.cloneElement` on the
// single element child, stamping `nativeID` and (conditionally — see the
// next paragraph) `testID` with `id` — the SAME two-prop treatment
// `Ignore.tsx`'s header comment already flags as required for whoever builds
// this ("this same iOS asymmetry" — JS `nativeID` reaches Android's lookup
// tag correctly, but on iOS it is `testID` that reaches
// `accessibilityIdentifier`, which is what `AutoskeletonSensor.swift`
// actually reads). Not a wrapping `View`, for the same layout-neutrality
// reason `Ignore` gives.
//
// THE testID CLOBBER BUG this fixes (adversarial review, batch 3): the
// original implementation stamped `testID: props.id` UNCONDITIONALLY, which
// silently destroyed whatever `testID` the consumer had already set on that
// element. `testID` is not an incidental prop — it is THE element handle
// every e2e suite matches on, and both platforms confirm it (verified from
// `node_modules/react-native`, not assumed):
//   - Android `BaseViewManager.setTestId` -> `view.setTag(R.id.react_test_id,
//     testId)` plus the plain `view.setTag(testId)` kept "to avoid end to end
//     test regressions" (its own comment).
//   - iOS `RCTViewComponentView.mm` -> `self.accessibilityIdentifier`.
// So wrapping a previously-green element in `<AutoSkeleton.Hint>` made the
// consumer's Detox/Maestro/Appium/argent selector stop matching, with
// nothing anywhere saying we did it. Breaking a consumer's test suite
// silently is worse than crashing, because the crash gets attributed
// correctly and this does not.
//
// THE RESOLUTION, and why it is not just "stop stamping testID": the two
// lookup channels are genuinely asymmetric (same verification as above), so
// dropping `testID` would trade one silent failure for another —
//   - `nativeID` is what Android's `AutoskeletonSensor.kt` reads
//     (`view.getTag(R.id.view_tag_native_id)`), and it is read by NO e2e
//     tool, so it stays ours: we keep stamping `props.id` there.
//   - `testID` is what iOS's `AutoskeletonSensor.swift` reads
//     (`view.accessibilityIdentifier`), so on iOS our lookup key and the
//     consumer's e2e handle are LITERALLY THE SAME NATIVE PROPERTY. That is
//     a real conflict, not an ordering preference.
// When the child already set a `testID`, the consumer's value wins (their
// suite keeps passing) AND the hint values are additionally registered under
// that value as an alias node id — so the iOS sensor, which will now see
// their string in `accessibilityIdentifier`, still resolves the hint. Both
// halves keep working; neither is silently sacrificed. A `__DEV__` warning
// (once per distinct conflict, never per render) names both ids and the
// element, following `core/metrics.ts`'s established
// `formatXWarning`/`emitX` split.
//
// NOT CHANGED, deliberately: `<AutoSkeleton.Ignore>` has the identical
// clobber, but its channel value is a fixed SENTINEL both native sensors
// compare against literally (`AUTOSKELETON_IGNORE_MARKER_ID`), so there is
// no alias to register — preserving a consumer `testID` there would make
// `Ignore` silently stop working on iOS. Fixing it needs a native-side
// change (a second, non-`accessibilityIdentifier` marker channel) and is
// out of this fix's scope; flagged, not silently absorbed.
//
// REGISTRATION: `registerHint` (`core/hint-registry.ts`) is called
// synchronously in this function's own body — no `useEffect`, on purpose
// (see that module's header comment for the full safety argument: React
// fully renders a subtree, including every `Hint` in it, before any
// consumer reads the registry). Idempotent on a re-render: the latest
// `lines`/`radius` always wins for a still-mounted `id`.

import { Children, cloneElement, type ReactElement, type ReactNode } from 'react';
import { registerHint } from '../core/hint-registry';

export interface AutoSkeletonHintProps {
  /** Developer-supplied identifier — the string stamped onto the child's
   *  `nativeID`, and onto its `testID` too UNLESS the child already set one
   *  of its own (see this module's header: a consumer `testID` is never
   *  overwritten). It should be unique among simultaneously mounted
   *  `<AutoSkeleton.Hint>`s (the same unscoped-namespace constraint RN's own
   *  `nativeID`/`testID` already carry — not a new one this feature
   *  introduces). Setting it to the child's OWN `testID` is the tidiest
   *  usage: one value keys both channels and no alias entry is registered. */
  readonly id: string;
  /** Synthesized line-count override for a collapsed text leaf. */
  readonly lines?: number;
  /** Corner-radius override, in the leaf's own coordinate units. On
   *  Android, this is the PRIMARY radius mechanism for rounded content
   *  (ADR-2 R0 — no public API can otherwise recover it, brief §9c). On
   *  iOS, `layer.cornerRadius` is always directly readable, so this
   *  OVERRIDES the measured value rather than filling a gap — a deliberate
   *  choice so one typed prop behaves consistently across platforms instead
   *  of silently doing nothing on iOS. */
  readonly radius?: number;
  readonly children: ReactNode;
}

/** Renders the element's name for the warning message. `cloneElement`
 *  targets are usually host components (`type` is the string `'View'`), but
 *  a composite child that forwards `testID` is equally valid — name it by
 *  `displayName`/`name` so the message points at something the developer can
 *  actually find in their own source. */
function describeChild(child: ReactElement<Record<string, unknown>>): string {
  const type: unknown = child.type;
  if (typeof type === 'string') {
    return `<${type}>`;
  }
  if (typeof type === 'function') {
    const named = type as { displayName?: string; name?: string };
    return `<${named.displayName ?? named.name ?? 'Component'}>`;
  }
  return '<Component>';
}

/** REQ-OBS-style actionable dev warning, pure and env-free so it is testable
 *  on its own — the same `formatXWarning` split `core/metrics.ts` and
 *  `web/ssr/uncaptured-warning.ts` already use. States what we did, why the
 *  hint still works, and the one-line way to make the conflict go away. */
export function formatHintTestIdConflictWarning(
  hintId: string,
  consumerTestId: string,
  childDescription: string,
): string {
  return (
    `[autoskeleton] <AutoSkeleton.Hint id="${hintId}"> wraps a ${childDescription} that already ` +
    `sets testID="${consumerTestId}". Keeping YOUR testID — it is the handle your e2e suite ` +
    'matches on, and overwriting it would silently break tests that already pass. On iOS the ' +
    'sensor reads accessibilityIdentifier (which is exactly what testID sets), so the hint is ' +
    `additionally registered under "${consumerTestId}" and still applies. To key the hint off a ` +
    `single value and silence this warning, use <AutoSkeleton.Hint id="${consumerTestId}">.`
  );
}

/** `__DEV__` is the native dev gate this codebase already uses
 *  (`src/native/AutoSkeleton.tsx`); the `NODE_ENV` arm is the same fallback
 *  convention `web/ssr/uncaptured-warning.ts` uses, and is what makes this
 *  reachable under the plain Vitest `node` environment, where Metro never
 *  defines `__DEV__`. */
function devWarningsEnabled(): boolean {
  if (typeof __DEV__ !== 'undefined') {
    return __DEV__;
  }
  return typeof process === 'undefined' || process.env?.['NODE_ENV'] !== 'production';
}

/** Latches every distinct `id`+`testID` pair already reported, so a conflict
 *  warns ONCE rather than on every render of a component that re-renders
 *  freely (a per-render warning is noise a developer learns to scroll past,
 *  which is the same as no warning). Mirrors
 *  `nativeModuleAccessor.ts`'s once-per-process latch. */
const warnedTestIdConflicts = new Set<string>();

/** Test-only reset of the once-per-conflict latch — same convention as
 *  `nativeModuleAccessor.ts`'s `__resetNativeModuleUnavailableWarningForTests`
 *  and `hint-registry.ts`'s `clearHintRegistry`. */
export function __resetHintTestIdConflictWarningsForTests(): void {
  warnedTestIdConflicts.clear();
}

function warnTestIdConflictOnce(
  hintId: string,
  consumerTestId: string,
  child: ReactElement<Record<string, unknown>>,
): void {
  if (!devWarningsEnabled()) {
    return;
  }
  const key = `${hintId}\u0000${consumerTestId}`;
  if (warnedTestIdConflicts.has(key)) {
    return;
  }
  warnedTestIdConflicts.add(key);
  // eslint-disable-next-line no-console
  console.warn(formatHintTestIdConflictWarning(hintId, consumerTestId, describeChild(child)));
}

export function Hint(props: AutoSkeletonHintProps): React.JSX.Element {
  const values = { lines: props.lines, radius: props.radius };
  registerHint(props.id, values);

  const child = Children.only(props.children) as ReactElement<Record<string, unknown>>;
  const consumerTestId = child.props['testID'];

  // Nothing of the consumer's to protect — the original, unchanged behavior.
  if (typeof consumerTestId !== 'string' || consumerTestId === props.id) {
    return cloneElement(child, { nativeID: props.id, testID: props.id });
  }

  // The consumer's e2e handle wins; the alias keeps the iOS lookup alive.
  registerHint(consumerTestId, values);
  warnTestIdConflictOnce(props.id, consumerTestId, child);
  return cloneElement(child, { nativeID: props.id });
}
