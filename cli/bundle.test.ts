// cli/bundle.test.ts
//
// RISK-5 packaging fix (see `cli/bundle.ts`'s header comment): proves
// `loadOrBuildBundle` prefers a prebuilt `browser-runtime.bundle.js` over
// invoking `esbuild` when one exists next to it — the path a real published
// consumer always takes, and the reason `esbuild` no longer needs to be
// resolvable at all in that case.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadOrBuildBundle } from './bundle';

let dir: string | undefined;

afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

describe('loadOrBuildBundle', () => {
  it('returns the prebuilt bundle content verbatim when browser-runtime.bundle.js exists, without invoking esbuild', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'askl-bundle-'));
    const marker = '/* prebuilt marker, not a real esbuild IIFE output */ window.__x__ = 1;';
    await writeFile(path.join(dir, 'browser-runtime.bundle.js'), marker, 'utf8');

    const result = await loadOrBuildBundle(dir);

    expect(result).toBe(marker);
  });

  it('falls back to bundling from source when no prebuilt bundle exists at that directory', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'askl-bundle-empty-'));

    const result = await loadOrBuildBundle(dir);

    // The real cli/browser-runtime.ts, esbuild-bundled as an IIFE, exposes
    // this global — proves the fallback genuinely built the real source
    // rather than returning nothing or a stub.
    expect(result).toContain('__autoskeletonCapture__');
  });
});
