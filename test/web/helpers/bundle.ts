// test/web/helpers/bundle.ts
//
// plan.md §7.3: "runs the production DOM sensor inside `page.evaluate`". A
// Playwright page cannot `import` TypeScript source directly, so this helper
// bundles a small entry file (esbuild, already a transitive devDependency via
// vite/vitest — see package-lock.json) into a single browser-ready IIFE
// string, which tests inject via `page.addScriptTag({ content })`. This is
// the REAL production module graph, transpiled but not reimplemented —
// exactly what plan.md §7.3 requires ("runs the production DOM sensor"),
// never a hand-rolled test double.

import { build } from 'esbuild';

const cache = new Map<string, Promise<string>>();

/** Bundles `entryPath` (an absolute path to a `.ts`/`.tsx` file that attaches
 *  everything a spec needs to a global, e.g. `window.Autoskeleton = {...}`)
 *  into an IIFE string. Cached per entry path for the life of the test
 *  process — esbuild is fast, but there is no reason to re-bundle per test. */
export function bundleEntry(entryPath: string): Promise<string> {
  const cached = cache.get(entryPath);
  if (cached) {
    return cached;
  }
  const promise = build({
    entryPoints: [entryPath],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
    jsxImportSource: 'react',
    define: { 'process.env.NODE_ENV': JSON.stringify('development') },
    loader: { '.ts': 'ts', '.tsx': 'tsx' },
  }).then((result) => {
    const output = result.outputFiles?.[0];
    if (!output) {
      throw new Error(`esbuild produced no output for entry ${entryPath}`);
    }
    return output.text;
  });
  cache.set(entryPath, promise);
  return promise;
}
