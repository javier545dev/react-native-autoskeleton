// cli/bundle.ts
//
// tasks.md 8.1: bundles `cli/browser-runtime.ts` into a browser-ready IIFE
// string for `page.addScriptTag`. Deliberately a small, local duplicate of
// `test/web/helpers/bundle.ts`'s esbuild wrapper rather than an import from
// `test/` — `cli/` is shippable production code (its own `exports['./cli']`
// subpath), and `test/` is excluded from the published `files` list, so a
// runtime dependency from `cli/` on `test/` would break for a real consumer.

import path from 'node:path';
import { build } from 'esbuild';

let cached: Promise<string> | undefined;

/** Bundles `cli/browser-runtime.ts` exactly once per process and caches the
 *  result — `runCapture` calls this once per run regardless of how many
 *  (skeletonKey x bucket x direction) combinations it captures. Resolves the
 *  entry via `__dirname` (never `import.meta.url`) so this module loads
 *  identically whether the caller's toolchain compiles it to CommonJS
 *  (Playwright's test transform, `tsc`'s CommonJS target) or runs it as ESM
 *  (Vitest/Vite-node) — `import.meta` is syntactically invalid in a
 *  CommonJS module and would hard-fail at parse time under the former. */
export function bundleCaptureRuntime(): Promise<string> {
  cached ??= build({
    entryPoints: [path.join(__dirname, 'browser-runtime.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    loader: { '.ts': 'ts' },
  }).then((result) => {
    const output = result.outputFiles?.[0];
    if (!output) {
      throw new Error('esbuild produced no output for cli/browser-runtime.ts');
    }
    return output.text;
  });
  return cached;
}
