import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Task 2.5 (tasks.md Phase 2): NFR-6 — "the web entry (`.`, no theming
// interops) is < 9 kB gzip with no runtime dependency beyond React." ADR-3's
// own caveat is load-bearing here: this MUST be measured on a real consumer
// BUNDLE (tree-shaken, minified), never on builder-bob's output, which is an
// unbundled, unminified per-file transpile and would give a meaningless
// number in either direction (plan.md §7.6, ADR-3).
//
// This bundles the REAL builder-bob output (`lib/module/index.web.js`, the
// exact file `exports['.'].browser` resolves to) through Vite in library
// mode with `react`/`react-dom` external — exactly what NFR-6's own text
// says the budget excludes ("no runtime dependency beyond React"). It does
// not use the `examples/vite` demo app directly (that app renders a full
// React shell — `react-dom` alone dwarfs the budget — so measuring ITS
// bundle would only ever tell you about React, never about this package).
//
// Run in isolation: `vitest run test/packaging/web-bundle.test.ts`.

const repoRoot = path.resolve(__dirname, '../..');
// NFR-6 has been revised TWICE — a third revision needs to argue against
// this precedent, not just raise the number:
//   1. 5 kB -> 8 kB (2026-08-27): the original 5 kB came from the kickoff
//      prompt and was never validated against an implementation. First real
//      measurement was 7566 B gzip, dominated by product code (AutoSkeleton,
//      dom-sensor, css-renderer), not incidental bloat.
//   2. 8 kB -> 9 kB (2026-08-28): the 8 kB gate DID its job — it forced a
//      design decision instead of letting the bundle grow silently — but the
//      decision it forced was giving web a DIFFERENT typed-hint API from
//      native (no `<AutoSkeleton.Hint>` on web, only a raw `data-*`
//      attribute), landing at 8185/8192 B, 7 bytes of headroom. A per-platform
//      API asymmetry is a worse outcome than ~250 bytes for a library whose
//      entire proposition is "one package, all platforms" — raised
//      deliberately to buy back API symmetry (`src/web/Hint.tsx`), not
//      because the gate was inconvenient. See spec.md NFR-6 for the full
//      rationale and plan.md §11 item 5 for the resolved open question.
//   3. NOT a revision — a MEASUREMENT CORRECTION (2026-08-29, G.18). The
//      budget was never relaxed here; the ruler was wrong. Vite's library
//      mode preserves whitespace and comments so `/* @__PURE__ */` survives
//      for the consumer's bundler, so the old gate charged this package for
//      910 lines of its own doc prose — roughly 200 gzip bytes per 370
//      characters of English, a direct tax on commenting the code well, and
//      a number no consumer has ever downloaded. The build now models an app
//      (see `beforeAll`). On identical input the same bundle measured 9023 B
//      as a library and 7474 B as an app.
//      The budget is re-derived to keep the gate EXACTLY as strict as it was,
//      so this buys zero room: the last library-mode run measured 8995 B
//      against 9216, i.e. 221 B of real headroom, and 7475 + 221 = 7696.
//      Spending those 221 bytes is still a deliberate act, and they are now
//      221 bytes a consumer actually pays.
// This remains a HARD FAILING GATE, not a downgrade to a tracked budget.
const NFR6_BUDGET_BYTES = 7696;

let outDir: string;
let bundlePath: string;

beforeAll(async () => {
  // `lib/` is rebuilt from current `src/` exactly once, in Vitest's
  // `globalSetup` (see `test/packaging/global-setup.ts`), strictly before this
  // file's `beforeAll` runs — NOT here. Running `bob build` again in this
  // file's own `beforeAll` would re-race with `entries.test.ts`'s `npm pack`,
  // which is the exact structural hazard `global-setup.ts` exists to close.
  const entry = path.join(repoRoot, 'lib/module/index.web.js');
  outDir = mkdtempSync(path.join(tmpdir(), 'autoskeleton-web-bundle-'));

  // MEASURED AS AN APP, NOT AS A LIBRARY (G.18 correction). This file's own
  // header has always said the number "MUST be measured on a real consumer
  // BUNDLE (tree-shaken, minified)". Vite's LIBRARY mode does not produce one:
  // it deliberately sets esbuild's `minifyWhitespace: false` so `/* @__PURE__ */`
  // annotations survive for the consumer's own bundler to use. Identifiers were
  // mangled, but every newline, indent and doc comment shipped into the measured
  // artifact — 910 lines of it. The gate was therefore charging this package for
  // its own documentation prose, at roughly 200 gzip bytes per 370 characters,
  // which is a direct tax on commenting the code well.
  //
  // A consumer does not run a library build; they run an app build. This now
  // models that: rollup bundles and tree-shakes, esbuild minifies for real.
  // Measured three ways on identical input before switching:
  //
  //   vite lib mode (what this used to do)      9023 B gzip   910 lines
  //   esbuild bundle + minify                   8209 B gzip     2 lines
  //   vite app mode (what a consumer ships)     7474 B gzip     2 lines
  //
  // The synthetic entry pins the WHOLE public namespace into a sink, so this
  // still measures the entire public API rather than whatever one consumer
  // happens to import — the same thing the lib-mode entry measured, so the
  // before/after numbers are comparable.
  const appDir = mkdtempSync(path.join(tmpdir(), 'autoskeleton-web-consumer-'));
  mkdirSync(path.join(appDir, 'src'), { recursive: true });
  const consumerEntry = path.join(appDir, 'src', 'main.js');
  writeFileSync(
    consumerEntry,
    `import * as lib from ${JSON.stringify(entry)};\nglobalThis.__autoskeletonSink = lib;\n`,
  );

  const { build } = await import('vite');
  await build({
    root: repoRoot,
    logLevel: 'silent',
    // A real consumer's own bundler replaces `process.env.NODE_ENV` with a
    // literal in a production build (Vite/webpack/Metro all do this) —
    // that literal is exactly what lets `debugOverlayEnabled = ... &&
    // process.env.NODE_ENV !== 'production'` dead-code-eliminate
    // `DebugOverlay` out of a production bundle (REQ-OBS-OVERLAY-1 / task
    // 2.4's own DoD: "dev-only, tree-shaken from production, verified by
    // 2.5"). Without this `define`, the check stays a runtime conditional
    // and DebugOverlay never gets eliminated — measuring a meaningfully
    // wrong (larger) number for what a real consumer actually ships.
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir,
      emptyOutDir: true,
      minify: 'esbuild',
      sourcemap: false,
      rollupOptions: {
        input: consumerEntry,
        // NFR-6's own text: the budget excludes React itself. A real
        // consumer app already ships react/react-dom regardless of whether
        // it uses autoskeleton, so this package's OWN incremental weight is
        // the only thing the budget can meaningfully describe.
        external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
        output: { entryFileNames: 'autoskeleton.web.js', format: 'es' },
      },
    },
  });
  rmSync(appDir, { recursive: true, force: true });

  bundlePath = path.join(outDir, 'autoskeleton.web.js');
}, 120_000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe('NFR-6: web entry gzip budget (measured on a real, fully minified consumer app bundle)', () => {
  it('produces a bundle file', () => {
    const bytes = readFileSync(bundlePath);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('the bundle never contains a react-native/Skia/Reanimated specifier (ADR-3 consequence)', () => {
    const source = readFileSync(bundlePath, 'utf8');
    for (const banned of ['react-native', '@shopify/react-native-skia', 'react-native-reanimated']) {
      expect(source).not.toContain(banned);
    }
  });

  it('DebugOverlay is tree-shaken out of a production build (task 2.4 DoD)', () => {
    const source = readFileSync(bundlePath, 'utf8');
    expect(source).not.toContain('askl-debug-overlay');
    expect(source).not.toContain('askl-debug-shape');
  });

  it('is under the NFR-6 gzip budget, measured as a consumer app bundle (failing gate; budget revised 2026-08-27 and 2026-08-28, measurement corrected 2026-08-29)', () => {
    const source = readFileSync(bundlePath);
    const gzipped = gzipSync(source, { level: 9 });
    // eslint-disable-next-line no-console
    console.log(
      `[NFR-6] autoskeleton web entry: ${source.length} bytes raw, ${gzipped.length} bytes gzip ` +
        `(budget: ${NFR6_BUDGET_BYTES} bytes)`,
    );
    expect(gzipped.length).toBeLessThan(NFR6_BUDGET_BYTES);
  });
});
