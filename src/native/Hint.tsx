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
// single element child, stamping BOTH `nativeID` and `testID` with `id` —
// the SAME two-prop treatment `Ignore.tsx`'s header comment already flags as
// required for whoever builds this ("this same iOS asymmetry" — JS
// `nativeID` reaches Android's lookup tag correctly, but on iOS it is
// `testID` that reaches `accessibilityIdentifier`, which is what
// `AutoskeletonSensor.swift` actually reads). Not a wrapping `View`, for the
// same layout-neutrality reason `Ignore` gives.
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
  /** Developer-supplied identifier — the SAME string stamped onto
   *  `nativeID`/`testID`, so it should be unique among simultaneously
   *  mounted `<AutoSkeleton.Hint>`s (the same unscoped-namespace constraint
   *  RN's own `nativeID`/`testID` already carry — not a new one this
   *  feature introduces). */
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

export function Hint(props: AutoSkeletonHintProps): React.JSX.Element {
  registerHint(props.id, { lines: props.lines, radius: props.radius });
  const child = Children.only(props.children) as ReactElement<Record<string, unknown>>;
  return cloneElement(child, {
    nativeID: props.id,
    testID: props.id,
  });
}
