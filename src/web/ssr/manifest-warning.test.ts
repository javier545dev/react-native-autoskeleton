// src/web/ssr/manifest-warning.test.ts
//
// Both failures this module reports degrade CORRECTLY but INVISIBLY: the
// developer sees a grey rectangle where their skeleton used to be, and
// nothing anywhere names the reason. These messages are the whole detection
// signal, so they are asserted for content, not merely for having fired.
//
// Mirrors `uncaptured-warning.test.ts`'s shape (pure formatter + gated emit).

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  __resetManifestWarningsForTests,
  emitManifestCssDriftWarning,
  emitManifestVersionWarning,
  formatManifestCssDriftWarning,
  formatManifestVersionWarning,
} from './manifest-warning';
import { SSR_MANIFEST_VERSION } from './manifest';

describe('formatManifestVersionWarning', () => {
  it('names both versions and the only real fix (regenerate, never hand-edit `v`)', () => {
    const message = formatManifestVersionWarning(1);
    expect(message).toContain('[autoskeleton]');
    expect(message).toContain('v=1');
    expect(message).toContain(`v=${SSR_MANIFEST_VERSION}`);
    expect(message).toContain('capture CLI');
  });
});

describe('formatManifestCssDriftWarning', () => {
  it('names BOTH tokens, so the developer can tell which artifact is stale', () => {
    const message = formatManifestCssDriftWarning('askl1-1111111111111111', 'askl1-2222222222222222');
    expect(message).toContain('askl1-1111111111111111');
    expect(message).toContain('askl1-2222222222222222');
    expect(message).toContain('manifest.json');
    expect(message).toContain('bundle.css');
  });

  it('renders an absent CSS token readably rather than as an empty gap', () => {
    expect(formatManifestCssDriftWarning('askl1-1111111111111111', '')).toContain('<none>');
  });
});

describe('emit* — dev-gated, latched once', () => {
  let warnSpy: MockInstance<(...args: unknown[]) => void>;

  beforeEach(() => {
    __resetManifestWarningsForTests();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined) as unknown as MockInstance<
      (...args: unknown[]) => void
    >;
  });

  afterEach(() => {
    warnSpy.mockRestore();
    __resetManifestWarningsForTests();
  });

  it('emits a version warning once, no matter how many times a page re-renders', () => {
    emitManifestVersionWarning(1);
    emitManifestVersionWarning(1);
    emitManifestVersionWarning(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('emits separately for a genuinely different version — a different mistake', () => {
    emitManifestVersionWarning(1);
    emitManifestVersionWarning(99);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('emits a drift warning once per distinct token pair', () => {
    emitManifestCssDriftWarning('askl1-a', 'askl1-b');
    emitManifestCssDriftWarning('askl1-a', 'askl1-b');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('stays silent in a production build', () => {
    const previous = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    try {
      emitManifestVersionWarning(1);
      emitManifestCssDriftWarning('askl1-a', 'askl1-b');
      expect(warnSpy).toHaveBeenCalledTimes(0);
    } finally {
      if (previous === undefined) {
        delete process.env['NODE_ENV'];
      } else {
        process.env['NODE_ENV'] = previous;
      }
    }
  });
});
