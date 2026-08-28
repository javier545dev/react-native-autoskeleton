// src/core/theme-override.test.ts
//
// tasks.md 7.2 (spec REQ-THEME-2): pure per-instance theme-override merge
// logic used by the native `<AutoSkeleton>`'s `shimmerBaseColor`/
// `shimmerHighlightColor`/`defaultRadius` props (7.2) — the mapping TARGET
// the theming interop (`src/interop/uniwind.ts`; uniwind is the sole theming
// interop — see tasks.md 7.5) writes onto. Kept in `src/core/` (ADR-4:
// platform-agnostic, no styling-system awareness) so the merge itself is
// genuinely unit testable without any native rendering harness, rather than
// only provable via native E2E.

import { describe, expect, it } from 'vitest';
import { applyThemeOverride } from './theme-override';
import type { SkeletonTheme } from './contracts';

const BASE_THEME: SkeletonTheme = {
  baseColor: '#e2e2e2',
  highlightColor: '#f5f5f5',
  defaultRadius: 4,
  speedMs: 1400,
};

describe('applyThemeOverride (tasks.md 7.2, REQ-THEME-2)', () => {
  it('returns the theme unchanged when no override field is provided', () => {
    expect(applyThemeOverride(BASE_THEME, {})).toEqual(BASE_THEME);
  });

  it('overrides only baseColor when only baseColor is provided', () => {
    const result = applyThemeOverride(BASE_THEME, { baseColor: '#336699' });
    expect(result).toEqual({ ...BASE_THEME, baseColor: '#336699' });
  });

  it('overrides only highlightColor when only highlightColor is provided', () => {
    const result = applyThemeOverride(BASE_THEME, { highlightColor: '#99ccff' });
    expect(result).toEqual({ ...BASE_THEME, highlightColor: '#99ccff' });
  });

  it('overrides only defaultRadius when only defaultRadius is provided, including a literal 0', () => {
    expect(applyThemeOverride(BASE_THEME, { defaultRadius: 12 })).toEqual({ ...BASE_THEME, defaultRadius: 12 });
    // `0` is a real, meaningful radius value (square corners) — must not be
    // treated as "absent" the way `||` would incorrectly do.
    expect(applyThemeOverride(BASE_THEME, { defaultRadius: 0 })).toEqual({ ...BASE_THEME, defaultRadius: 0 });
  });

  it('overrides all three fields simultaneously, leaving speedMs untouched (no theming-interop mapping for it)', () => {
    const result = applyThemeOverride(BASE_THEME, {
      baseColor: '#111111',
      highlightColor: '#222222',
      defaultRadius: 8,
    });
    expect(result).toEqual({ baseColor: '#111111', highlightColor: '#222222', defaultRadius: 8, speedMs: 1400 });
  });

  it('does not mutate the input theme object', () => {
    const original = { ...BASE_THEME };
    applyThemeOverride(BASE_THEME, { baseColor: '#000000' });
    expect(BASE_THEME).toEqual(original);
  });
});
