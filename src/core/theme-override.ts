// src/core/theme-override.ts
//
// tasks.md 7.2 (spec REQ-THEME-2): pure per-instance theme-override merge —
// the target the theming interops (`src/interop/uniwind.ts`, `src/interop/
// nativewind.ts`) map className-resolved values onto, via the native
// `<AutoSkeleton>`'s `shimmerBaseColor`/`shimmerHighlightColor`/
// `defaultRadius` props. Lives in `src/core/` (ADR-4: zero platform-specific
// imports, zero styling-system awareness) — this module has no idea a
// styling system exists; it only merges plain data.

import type { SkeletonTheme } from './contracts';

export interface ThemeOverride {
  readonly baseColor?: string;
  readonly highlightColor?: string;
  readonly defaultRadius?: number;
}

/** Merges `override`'s DEFINED fields onto `theme`, leaving every other
 *  field (including `speedMs`, which no interop maps) untouched. `??` is
 *  used deliberately over `||` — `defaultRadius: 0` is a real, meaningful
 *  value (square corners), not an absent one. Never mutates `theme`. */
export function applyThemeOverride(theme: SkeletonTheme, override: ThemeOverride): SkeletonTheme {
  return {
    ...theme,
    baseColor: override.baseColor ?? theme.baseColor,
    highlightColor: override.highlightColor ?? theme.highlightColor,
    defaultRadius: override.defaultRadius ?? theme.defaultRadius,
  };
}
