// cli/route-safety.test.ts
//
// tasks.md 8.1 / plan.md §8 threat matrix — "Capture-CLI subprocess & route
// handling" is the ONE applicable row: this is the change's real process
// boundary (headless Chromium, developer-declared route strings, file
// writes). RED tests written FIRST per plan.md's ordering, before
// `cli/capture.ts` (which imports these functions) exists.

import { describe, expect, it } from 'vitest';
import { resolveCaptureUrl, resolveOutputFile } from './route-safety';

describe('resolveCaptureUrl (plan.md §8 threat matrix)', () => {
  const baseURL = 'http://localhost:4173';

  it('resolves a same-origin relative route against baseURL', () => {
    const url = resolveCaptureUrl(baseURL, '/dashboard');
    expect(url.toString()).toBe('http://localhost:4173/dashboard');
  });

  it('rejects a route that is an absolute URL to a third-party origin', () => {
    expect(() => resolveCaptureUrl(baseURL, 'https://evil.example/steal')).toThrow(
      /cross-origin|origin/i,
    );
  });

  it('rejects a route containing ../ traversal', () => {
    expect(() => resolveCaptureUrl(baseURL, '/../../etc/passwd')).toThrow(/\.\.|traversal/i);
  });

  it('passes a route with shell metacharacters through inertly (never a shell string)', () => {
    // Playwright navigates via its own HTTP client, never a shell — a route
    // string like this must resolve to a normal (if unusual) same-origin URL,
    // not be rejected, not be shell-interpreted.
    const url = resolveCaptureUrl(baseURL, '/dashboard?x=$(rm -rf /)&y=`id`;echo pwned');
    expect(url.origin).toBe(baseURL);
    expect(url.pathname).toBe('/dashboard');
  });

  it('rejects a route resolving to a different scheme (protocol-relative escape)', () => {
    expect(() => resolveCaptureUrl(baseURL, '//evil.example/x')).toThrow(/cross-origin|origin/i);
  });
});

describe('resolveOutputFile (plan.md §8 threat matrix)', () => {
  const outDir = '/tmp/autoskeleton-ssr-output';

  it('resolves a plain relative filename inside the configured output directory', () => {
    const resolved = resolveOutputFile(outDir, 'manifest.json');
    expect(resolved).toBe('/tmp/autoskeleton-ssr-output/manifest.json');
  });

  it('resolves a nested relative filename inside the configured output directory', () => {
    const resolved = resolveOutputFile(outDir, 'bundle/dashboard.css');
    expect(resolved).toBe('/tmp/autoskeleton-ssr-output/bundle/dashboard.css');
  });

  it('rejects an output path escaping the configured output directory via ../', () => {
    expect(() => resolveOutputFile(outDir, '../../etc/passwd')).toThrow(/escape|outside/i);
  });

  it('rejects an absolute output path outside the configured output directory', () => {
    expect(() => resolveOutputFile(outDir, '/etc/passwd')).toThrow(/escape|outside/i);
  });
});
