// test/packaging/helpers/web-bundle.ts
//
// THE ONE PLACE THAT MEASURES NFR-6.
//
// Before this module there were two: `test/packaging/web-bundle.test.ts` (the
// failing gate) and `benchmarks/support/web-benchmarks.ts` (the reported
// benchmark). `budgets.json` even carried a comment warning that its number
// and the gate's "must be changed together or they will silently diverge".
// They diverged anyway — a comment is not a mechanism. The gate's measurement
// was corrected to an APP build in commit 4dae7c0 and the benchmark was left
// on a LIBRARY build, so the same NFR was being reported at 9418 B against a
// 9216 B budget while the real gate read 7712 B against 7933 B: 1706 bytes
// apart, both "passing", neither describing the other.
//
// The fix is structural, not documentary. There is exactly one build
// configuration, exported here, and both call sites import it. There is
// exactly one budget, `webEntryGzipBytes` in `benchmarks/budgets.json`, and
// both read it through `loadBudgets()`. Divergence is no longer something to
// remember not to do; it is something you would have to go out of your way to
// reintroduce, and `web-bundle-single-source.test.ts` fails if you do.
//
// ── Why an APP build and not a LIBRARY build ────────────────────────────────
//
// Vite's library mode deliberately sets esbuild's `minifyWhitespace: false` so
// `/* @__PURE__ */` annotations survive for the consumer's own bundler. Every
// newline, indent and doc comment therefore shipped into the measured
// artifact — 910 lines of it — so the budget was charging this package for its
// own documentation prose at roughly 200 gzip bytes per 370 characters of
// English. That is a direct tax on commenting the code well, and it is a
// number no consumer has ever downloaded.
//
// A consumer does not run a library build; they run an app build. Measured
// three ways on identical input before switching:
//
//   vite lib mode                            9023 B gzip   910 lines
//   esbuild bundle + minify                  8209 B gzip     2 lines
//   vite app mode (what a consumer ships)    7474 B gzip     2 lines
//
// The synthetic entry pins the WHOLE public namespace into a sink, so this
// still measures the entire public API rather than whatever one consumer
// happens to import — the same surface the lib-mode entry measured, which is
// what makes the before/after numbers comparable.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const REPO_ROOT = path.resolve(__dirname, '../../..');

/** The exact file `exports['.'].browser` resolves to — builder-bob output,
 *  never `src/`. */
export const WEB_ENTRY = path.join(REPO_ROOT, 'lib/module/index.web.js');

export interface WebEntryBundle {
  /** Absolute path of the emitted bundle. Valid until `cleanup()`. */
  readonly bundlePath: string;
  /** The emitted bundle's bytes. */
  readonly source: Buffer;
  readonly rawBytes: number;
  readonly gzipBytes: number;
  /** Removes the temporary build output. Safe to call more than once. */
  cleanup(): void;
}

/**
 * Bundles the real builder-bob web entry the way a consumer's production app
 * bundler would — rollup tree-shakes, esbuild minifies for real, React stays
 * external — and reports raw and gzip size.
 *
 * Requires `lib/` to already exist. Building it is the caller's job on
 * purpose: both suites build `lib/` exactly once in a `globalSetup`, and a
 * second writer here is precisely the race those setups exist to close.
 */
export async function measureWebEntryAsConsumerApp(): Promise<WebEntryBundle> {
  const outDir = mkdtempSync(path.join(tmpdir(), 'autoskeleton-web-bundle-'));
  const appDir = mkdtempSync(path.join(tmpdir(), 'autoskeleton-web-consumer-'));

  try {
    mkdirSync(path.join(appDir, 'src'), { recursive: true });
    const consumerEntry = path.join(appDir, 'src', 'main.js');
    writeFileSync(
      consumerEntry,
      `import * as lib from ${JSON.stringify(WEB_ENTRY)};\nglobalThis.__autoskeletonSink = lib;\n`,
    );

    const { build } = await import('vite');
    await build({
      root: REPO_ROOT,
      logLevel: 'silent',
      // A real consumer's own bundler replaces `process.env.NODE_ENV` with a
      // literal in a production build (Vite/webpack/Metro all do this) — that
      // literal is exactly what lets `debugOverlayEnabled = ... &&
      // process.env.NODE_ENV !== 'production'` dead-code-eliminate
      // `DebugOverlay` out of a production bundle (REQ-OBS-OVERLAY-1 / task
      // 2.4's DoD). Without this `define` the check stays a runtime
      // conditional, DebugOverlay never gets eliminated, and the measurement
      // is meaningfully wrong (larger) for what a consumer actually ships.
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      build: {
        outDir,
        emptyOutDir: true,
        minify: 'esbuild',
        sourcemap: false,
        rollupOptions: {
          input: consumerEntry,
          // NFR-6's own text: the budget excludes React itself. A real
          // consumer app already ships react/react-dom whether or not it uses
          // autoskeleton, so this package's OWN incremental weight is the only
          // thing the budget can meaningfully describe.
          external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
          output: { entryFileNames: 'autoskeleton.web.js', format: 'es' },
        },
      },
    });

    const bundlePath = path.join(outDir, 'autoskeleton.web.js');
    const source = readFileSync(bundlePath);
    return {
      bundlePath,
      source,
      rawBytes: source.length,
      gzipBytes: gzipSync(source, { level: 9 }).length,
      cleanup: () => rmSync(outDir, { recursive: true, force: true }),
    };
  } finally {
    rmSync(appDir, { recursive: true, force: true });
  }
}
