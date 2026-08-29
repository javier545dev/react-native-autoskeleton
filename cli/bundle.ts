// cli/bundle.ts
//
// tasks.md 8.1: resolves `cli/browser-runtime.ts`'s bundled IIFE for
// `page.addScriptTag`. Deliberately a small, local duplicate of
// `test/web/helpers/bundle.ts`'s esbuild wrapper rather than an import from
// `test/` — `cli/` is shippable production code (its own `exports['./cli']`
// subpath), and `test/` is excluded from the published `files` list, so a
// runtime dependency from `cli/` on `test/` would break for a real consumer.
//
// RISK-5 packaging fix (orchestrator-found defect — see
// `test/packaging/entries.test.ts`'s "no runtime `dependencies` footprint"
// guard): `cli/browser-runtime.ts` is a STATIC file — its bundled output
// never varies per capture run or per capture argument (verify: it only
// exposes `window.__autoskeletonCapture__.captureRoot`, whose per-call
// arguments are supplied later, at `page.evaluate` time, not baked into the
// bundle). There is therefore no need to invoke `esbuild` at capture time
// at all: `scripts/build-cli.mjs` pre-bundles it ONCE, at `npm run
// build:cli` time, into `browser-runtime.bundle.js` next to the published
// `dist-cli/capture.js`. `bundleCaptureRuntime` reads that prebuilt file
// when present — the path a real published consumer always takes, needing
// `esbuild` not at all, not even as a peer dependency.
//
// The on-the-fly esbuild build below is a DEV/TEST FALLBACK ONLY, reachable
// when running `cli/capture.ts` directly from this repo's own source tree
// (`__dirname` = `cli/`, where no prebuilt bundle is ever written) before
// `npm run build:cli` has produced `dist-cli/browser-runtime.bundle.js`.
// `esbuild` is a plain `devDependency` of this repo for exactly that case —
// never required by a published consumer.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isModuleNotFoundFor } from './peer-dependency';

const PREBUILT_BUNDLE_FILENAME = 'browser-runtime.bundle.js';
const ESBUILD_SPECIFIER = 'esbuild';

let cached: Promise<string> | undefined;

/** Bundles (or reads the prebuilt) `cli/browser-runtime.ts` exactly once
 *  per process and caches the result — `runCapture` calls this once per run
 *  regardless of how many (skeletonKey x bucket x direction) combinations
 *  it captures. */
export function bundleCaptureRuntime(): Promise<string> {
  cached ??= loadOrBuildBundle(__dirname);
  return cached;
}

/** `prebuiltDir` is exposed (not just an internal `__dirname` constant) so
 *  the prebuilt-vs-fallback branch is directly unit-testable against a real
 *  temp directory, without writing into this repo's own `cli/` source tree
 *  or mocking `node:fs`. `bundleCaptureRuntime` above always calls this with
 *  its own real `__dirname`. */
export async function loadOrBuildBundle(prebuiltDir: string): Promise<string> {
  const prebuiltPath = path.join(prebuiltDir, PREBUILT_BUNDLE_FILENAME);
  try {
    return await readFile(prebuiltPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  return buildFromSource();
}

/** Minimal structural type for the ONE `esbuild.build` shape this file
 *  uses — deliberately NOT `typeof import('esbuild')`. `cli/index.ts`'s
 *  published `exports['./cli'].types` points at raw TypeScript source
 *  (task 9.5), so a CONSUMER's own `tsc` type-checks this whole file
 *  transitively when they `import ... from 'autoskeleton/cli'` — even
 *  though `esbuild` is only ever `require()`d here at runtime, in a branch
 *  a published consumer never reaches (see the header comment). A
 *  `typeof import('esbuild')` type reference would force `esbuild`'s own
 *  package types to be resolvable at that consumer's typecheck time too,
 *  reintroducing exactly the unconditional footprint this fix removes —
 *  caught by actually typechecking from a fresh installed consumer, not
 *  assumed (mirrors task 9.5's own `browser-runtime.ts` ambient-decl fix). */
interface MinimalEsbuildModule {
  build(options: {
    entryPoints: string[];
    bundle: boolean;
    write: boolean;
    format: string;
    platform: string;
    target: string;
    define: Record<string, string>;
    loader: Record<string, string>;
  }): Promise<{ outputFiles?: Array<{ text: string }> }>;
}

/** Dev/test-only fallback — see the header comment. Bundles directly from
 *  `cli/browser-runtime.ts`'s TypeScript source via `esbuild`, loaded
 *  lazily (never a static top-level import) so a published consumer, which
 *  always finds the prebuilt asset above and never reaches this function,
 *  is never forced to resolve `esbuild` at all. */
async function buildFromSource(): Promise<string> {
  // Resolves the entry via `__dirname` (never `import.meta.url`) so this
  // module loads identically whether the caller's toolchain compiles it to
  // CommonJS (Playwright's test transform, `tsc`'s CommonJS target) or runs
  // it as ESM (Vitest/Vite-node) — `import.meta` is syntactically invalid in
  // a CommonJS module and would hard-fail at parse time under the former.
  const entryPoint = path.join(__dirname, 'browser-runtime.ts');

  let esbuild: MinimalEsbuildModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    esbuild = require(ESBUILD_SPECIFIER) as MinimalEsbuildModule;
  } catch (error) {
    if (isModuleNotFoundFor(error, ESBUILD_SPECIFIER)) {
      throw new Error(
        `autoskeleton CLI: no prebuilt browser runtime bundle found at ` +
          `"${PREBUILT_BUNDLE_FILENAME}", and "${ESBUILD_SPECIFIER}" is not installed to build ` +
          'one on the fly. This path is only expected when developing against this repo\'s own ' +
          'source — run `npm run build:cli` to produce the prebuilt bundle, or ' +
          `\`npm install ${ESBUILD_SPECIFIER}\` to build from source.`,
      );
    }
    throw error;
  }

  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    loader: { '.ts': 'ts' },
  });
  const output = result.outputFiles?.[0];
  if (!output) {
    throw new Error('esbuild produced no output for cli/browser-runtime.ts');
  }
  return output.text;
}
