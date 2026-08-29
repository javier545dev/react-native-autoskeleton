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
// Bundling with esbuild sidesteps that entirely: everything reachable from
// `cli/index.ts` and `cli/capture.ts` (their own code plus the
// `src/core`/`src/web` modules they import) is inlined into two
// self-contained CommonJS files. `@playwright/test` stays EXTERNAL — it is
// an optional `peerDependency` of the published package (see
// package.json), loaded lazily at runtime by `cli/capture.ts`'s
// `loadChromium` so Node resolves it normally from the CONSUMER's own
// `node_modules` when they installed it, with an actionable error when they
// have not (RISK-5 packaging fix — see `cli/peer-dependency.ts`).
//
// `esbuild` is kept external here too (bundling a bundler in would vendor a
// huge, and actively wrong — native binary resolution — copy) but is NO
// LONGER a runtime dependency of the published package at all: task 9.6
// (RISK-5 packaging fix) moved it to a plain `devDependency`, because its
// only runtime use — bundling `cli/browser-runtime.ts` into the IIFE
// injected into the captured page — bundles a STATIC file with no
// per-capture parameterization (see `cli/bundle.ts`'s header comment). That
// bundle is now produced ONCE, right here, at publish time, and shipped as
// a plain browser-runtime.bundle.js` asset `dist-cli/capture.js` reads at
// runtime — `esbuild` itself is never `require()`d by a published consumer.

import { build } from 'esbuild';
import { chmod, mkdir } from 'node:fs/promises';
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
  await mkdir(path.join(repoRoot, 'dist-cli'), { recursive: true });

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

  // `cli/bundle.ts`'s `bundleCaptureRuntime()` reads
  // `path.join(__dirname, 'browser-runtime.bundle.js')` AT RUNTIME — a
  // plain browser-target IIFE bundle, not TypeScript source, so a published
  // consumer never invokes `esbuild` to produce it. Build it here with the
  // SAME options `cli/bundle.ts`'s dev-only fallback uses, `write: true`
  // straight to its final location next to `dist-cli/capture.js` (whose own
  // bundling above inlines `bundle.ts`'s CODE but cannot rewrite its
  // runtime `__dirname` string, which resolves to `dist-cli/` for the
  // published/bundled path — matching where this file is written).
  await build({
    entryPoints: ['cli/browser-runtime.ts'],
    outfile: 'dist-cli/browser-runtime.bundle.js',
    bundle: true,
    platform: 'browser',
    target: 'es2020',
    format: 'iife',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    absWorkingDir: repoRoot,
    logLevel: 'info',
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
