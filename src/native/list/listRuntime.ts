// src/native/list/listRuntime.ts
//
// Module-scope shared singletons for Phase 6's list components — mirrors
// `native/AutoSkeleton.tsx`'s own `defaultStore` pattern: one registry and
// one counter for the whole app session, so `SkeletonList`,
// `SkeletonListFooter` and `useSkeletonCell` all coordinate through the
// SAME per-itemType "has this been measured yet" state (ADR-13's "at most
// once, ever" rule only holds if every entry point shares one registry).

import { createTemplateRegistry, createTraversalCounter } from '../../core/list';

export const templateRegistry = createTemplateRegistry();

/** Counts ONLY traversals that actually executed via a deferred template
 *  measurement — never incremented from a bind call. `examples/bare-rn`
 *  reads this via a queryable on-screen node for the native E2E proof of
 *  ADR-13/RISK-3's "traversal counter stays flat" assertion. */
export const templateTraversalCounter = createTraversalCounter();
