#!/usr/bin/env node
// scripts/build-cli.mjs
//
// tasks.md 9.5 — bundles `cli/` into `dist-cli/` for publishing. `cli/`'s
// TypeScript source imports across the repo tree (`../src/core/*`,
// `../src/web/*`) using RELATIVE specifiers that assume this repo's own
// directory layout — react-native-builder-bob's per-file transpile (ADR-3)
// preserves those specifiers verbatim, so naively adding `cli/` as a second
// bob source would emit broken imports (`../src/core/cache-key` resolving
// against `lib/**/cli/` instead of the real compiled `core/` output).
//
// Bundling with esbuild (the SAME tool `cli/bundle.ts` already uses at
// capture-time to bundle the browser-side DOM sensor) sidesteps that
// entirely: everything reachable from `cli/index.ts` and `cli/capture.ts`
// (their own code plus the `src/core`/`src/web` modules they import) is
// inlined into two self-contained CommonJS files. `@playwright/test` and
// `esbuild` itself stay EXTERNAL — both are real `dependencies` of the
// published package (see package.json) so Node resolves them normally from
// the consumer's own `node_modules` at runtime, exactly like any other npm
// package with dependencies; bundling them in would vendor a huge, and in
// esbuild's case actively wrong (native binary resolution), copy.

import { build } from 'esbuild';
import { chmod, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['@playwright/test', 'esbuild'],
  absWorkingDir: repoRoot,
  logLevel: 'info',
};

async function main() {
  // The programmatic `autoskeleton/cli` entry (exports['./cli']).
  await build({
    ...shared,
    entryPoints: ['cli/index.ts'],
    outfile: 'dist-cli/index.js',
  });

  // The `bin` executable. `cli/capture.ts` already guards its `main()` with
  // `require.main === module`, so this bundle is both `require()`-able (for
  // completeness) and directly runnable as `node dist-cli/capture.js ...` /
  // via the `autoskeleton-capture` bin alias. NOTE: `cli/capture.ts` already
  // starts with its own `#!/usr/bin/env node` shebang line, which esbuild
  // preserves verbatim in the bundled output — no `banner` option needed
  // (and adding one would DUPLICATE the shebang, a real bug caught by
  // actually running the bundled output, not just building it).
  await build({
    ...shared,
    entryPoints: ['cli/capture.ts'],
    outfile: 'dist-cli/capture.js',
  });
  await chmod(path.join(repoRoot, 'dist-cli/capture.js'), 0o755);

  // `cli/bundle.ts`'s `bundleCaptureRuntime()` resolves
  // `path.join(__dirname, 'browser-runtime.ts')` AT RUNTIME to feed the raw
  // TypeScript source into its own separate (browser-target) esbuild call —
  // a real trap for the bundled `bin`/`./cli` output specifically: esbuild's
  // static bundling inlines `bundle.ts`'s CODE into `dist-cli/capture.js`,
  // but it cannot rewrite that RUNTIME `__dirname` string, which will then
  // point at `dist-cli/` (the bundle's own location), not `cli/`. Copying
  // the raw source alongside the bundle keeps that runtime lookup valid for
  // both the in-repo path (`cli/capture.ts` run directly, `__dirname` =
  // `cli/`) and the published/bundled path (`dist-cli/capture.js`,
  // `__dirname` = `dist-cli/`) without changing `cli/bundle.ts`'s logic.
  await mkdir(path.join(repoRoot, 'dist-cli'), { recursive: true });
  await copyFile(
    path.join(repoRoot, 'cli/browser-runtime.ts'),
    path.join(repoRoot, 'dist-cli/browser-runtime.ts'),
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
