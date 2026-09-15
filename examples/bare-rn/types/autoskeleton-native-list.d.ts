// examples/bare-rn/types/autoskeleton-native-list.d.ts
//
// Narrow, example-app-scoped type augmentation for `autoskeleton`'s Phase 6
// native-only exports (`SkeletonCell`, `useSkeletonCell`,
// `templateTraversalCounter`).
//
// Root cause (a real, pre-existing packaging gap, not introduced by this
// file): `package.json#exports['.'].types` is a SINGLE string
// (`./lib/typescript/module/src/index.d.ts`, always the web/default entry's
// declarations), while the RUNTIME `react-native`/`browser`/`default`
// conditions correctly resolve to platform-specific JS
// (`index.native.js`/`index.web.js`). `AutoSkeleton`/`SkeletonProvider`
// never exposed this gap because both platform entries export identical
// names; Phase 6's `SkeletonCell`/`useSkeletonCell`/
// `templateTraversalCounter` are native-only, so TypeScript resolves their
// types against `index.web.d.ts`'s content and reports them missing, even
// though the real runtime module (resolved via Metro's `react-native`
// condition) genuinely exports them.
//
// A real fix belongs in `package.json#exports` (nesting `types` per
// platform condition), but `react-native-builder-bob`'s own `typescript`
// target validator rejects a non-string `exports['.'].types` value
// (confirmed from `node_modules/react-native-builder-bob/lib/src/targets/
// typescript.js` — it only recognizes nested `import.types`/`require.types`,
// not custom `react-native`/`browser` conditions), so that fix needs a
// dedicated follow-up task rather than a workaround stacked in this apply
// batch. Flagged, not silently patched over at the library level.
// The `export {}` below is load-bearing: without at least one top-level
// import/export, TypeScript treats this file as a global SCRIPT, and the
// `declare module 'autoskeleton'` block below becomes a brand-new ambient
// module declaration that SHADOWS the real one (dropping `AutoSkeleton`,
// `SkeletonProvider`, etc.) instead of augmenting/merging with it.
export {};

declare module 'autoskeleton' {
  import type { ComponentType, ReactNode } from 'react';

  export type AnimationKind = 'shimmer' | 'pulse' | 'none';

  export interface SkeletonCellProps {
    readonly itemType: string;
    readonly skeletonKey?: string;
    readonly renderTemplate?: () => ReactNode;
    readonly animation?: AnimationKind;
    readonly reducedMotion?: boolean;
  }
  export const SkeletonCell: ComponentType<SkeletonCellProps>;

  export interface TraversalCounter {
    readonly count: number;
    increment(): void;
    reset(): void;
  }
  export const templateTraversalCounter: TraversalCounter;

  export interface SkeletonListProps {
    readonly itemType: string;
    readonly estimatedCount: number;
    readonly skeletonKey?: string;
    readonly renderTemplate?: () => ReactNode;
    readonly animation?: AnimationKind;
    readonly reducedMotion?: boolean;
    readonly rowSpacing?: number;
  }
  export const SkeletonList: ComponentType<SkeletonListProps>;

  export interface SkeletonListFooterProps {
    readonly itemType: string;
    readonly estimatedCount: number;
    readonly skeletonKey?: string;
    readonly animation?: AnimationKind;
    readonly reducedMotion?: boolean;
    readonly rowSpacing?: number;
  }
  export const SkeletonListFooter: ComponentType<SkeletonListFooterProps>;

  export interface ShapeSnapshot {
    readonly key: string;
    readonly frameWidth: number;
    readonly frameHeight: number;
    readonly data: readonly number[];
  }
  export interface UseSkeletonCellOptions {
    readonly itemType: string;
    readonly skeletonKey?: string;
    readonly renderTemplate?: () => ReactNode;
  }
  export interface UseSkeletonCellResult {
    readonly snapshot: ShapeSnapshot | null;
    readonly cacheHit: boolean;
    readonly isFallback: boolean;
    readonly cacheKey: string;
    readonly pendingTemplateNode: ReactNode | null;
  }
  export function useSkeletonCell(options: UseSkeletonCellOptions): UseSkeletonCellResult;
}
