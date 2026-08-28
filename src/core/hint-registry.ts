// src/core/hint-registry.ts
//
// Typed-hint channel (spec §1.9/§8, plan.md ADR-2 R0, tasks.md's carried-over
// open item "the general typed-hint channel — radius/lines end-to-end").
//
// THE GAP this closes: `HintRegistry` (`contracts.ts`) has always been fully
// CONSUMED — `src/web/dom-sensor.ts`'s `leafShape`/`textLeafShapes` and both
// native sensors' `AutoskeletonPublicApiRadiusResolver`/`leafShapes` already
// call `hints.radiusFor(nodeId)`/`hints.linesFor(nodeId)` — but never
// PRODUCED: every call site passed an empty registry (`createEmptyHintRegistry()`
// on web/native JS, `AutoskeletonEmptyHintRegistry` on iOS/Android), because
// nothing built a real one from actual `<AutoSkeleton.Hint>` usage.
//
// THIS MODULE is the producer side, shared by both platforms' `Hint`
// components (`src/native/Hint.tsx`, `src/web/AutoSkeleton.tsx`'s `Hint`):
// - `registerHint`/`unregisterHint`: a small module-level registry, written
//   synchronously during a `Hint` component's own render (no hooks — see
//   `Hint.tsx`'s header comment for why this mirrors `Ignore`'s hookless,
//   directly-unit-testable shape). Safe because React fully renders a
//   subtree (including every `Hint` inside it) before any consumer reads
//   this registry: web reads it in-process during the SAME synchronous
//   traversal call; native reads a snapshot one `requestAnimationFrame`
//   after `onLayout`, well after the render pass that populated it.
// - `snapshotHintEntries`: the raw entries list, needed verbatim by the
//   native bridge (`NativeAutoskeleton.ts`'s `AutoskeletonGetShapesConfig.hints`)
//   because a `HintRegistry`'s functions cannot cross a Turbo Module
//   boundary, but this plain array can.
// - `createHintRegistry`: adapts a snapshot into the `HintRegistry` shape
//   `contracts.ts` already specifies, for in-process consultation (web's
//   `SensorOptions.hints`, and native's for `Sensor<TTarget>` contract
//   conformance even though the native bridge marshals raw entries instead).
//
// STATED LIMITATION, not a silent one: entries are keyed by a
// developer-supplied `id` (see `Hint.tsx`), not scoped per `<AutoSkeleton>`
// instance — exactly as unscoped as RN's own `nativeID`/`testID` namespace
// already is. A `Hint` that unmounts without ever re-registering leaves its
// last entry in the registry (no unmount cleanup: adding one would require
// converting `Hint` to a hook-based component, which would break the
// hookless, plain-function testability `Ignore` established and this module
// deliberately preserves). In practice this bounds growth by "distinct hint
// ids ever mounted", not "hints currently mounted" — the same class of
// accepted, documented trade-off `AutoskeletonNativeShapeCache` already makes
// (unbounded map, manual `evict`, no automatic GC).

import type { HintRegistry } from './contracts';

export interface HintValues {
  readonly lines?: number;
  readonly radius?: number;
}

export interface HintEntry extends HintValues {
  readonly nodeId: string;
}

const registry = new Map<string, HintValues>();

/** Writes/overwrites one node's hint values. Called synchronously from a
 *  `Hint` component's render body on every render, so the registry always
 *  reflects the LATEST props for a still-mounted node (idempotent on a
 *  double-render, e.g. React StrictMode). */
export function registerHint(nodeId: string, values: HintValues): void {
  registry.set(nodeId, values);
}

/** Removes a previously registered entry. Exported for completeness and
 *  tests; no current call site invokes it in production (see the module's
 *  stated no-unmount-cleanup limitation above). */
export function unregisterHint(nodeId: string): void {
  registry.delete(nodeId);
}

/** The raw entries, in insertion order. This is what crosses the native
 *  bridge as `AutoskeletonGetShapesConfig.hints` — never the `HintRegistry`
 *  functions themselves. */
export function snapshotHintEntries(): readonly HintEntry[] {
  return Array.from(registry, ([nodeId, values]) => ({ nodeId, ...values }));
}

/** Test-only full reset — mirrors `AutoskeletonNativeShapeCache.clear()`'s
 *  own test-only convention. Production code never needs to clear the whole
 *  registry (only targeted `unregisterHint`). */
export function clearHintRegistry(): void {
  registry.clear();
}

/** Adapts a snapshot of entries into the `HintRegistry` shape `contracts.ts`
 *  specifies — pure, takes no dependency on the live module-level registry,
 *  so it works identically for the current global registry's snapshot or
 *  any future scoped one. `isIgnored` is always `false`: `<AutoSkeleton.Ignore>`
 *  uses its own self-sufficient marker channel (`AUTOSKELETON_IGNORE_MARKER_ID`),
 *  never this registry — the same deliberate split task G.5's remediation
 *  established. */
export function createHintRegistry(entries: readonly HintEntry[]): HintRegistry {
  const lines = new Map<string, number>();
  const radius = new Map<string, number>();
  for (const entry of entries) {
    if (entry.lines !== undefined) {
      lines.set(entry.nodeId, entry.lines);
    }
    if (entry.radius !== undefined) {
      radius.set(entry.nodeId, entry.radius);
    }
  }
  return {
    linesFor: (nodeId) => lines.get(nodeId),
    radiusFor: (nodeId) => radius.get(nodeId),
    isIgnored: () => false,
  };
}
