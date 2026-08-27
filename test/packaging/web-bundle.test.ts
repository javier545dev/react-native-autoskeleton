import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Task 2.5 (tasks.md Phase 2): NFR-6 — "the web entry (`.`, no theming
// interops) is < 8 kB gzip with no runtime dependency beyond React." ADR-3's
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
// REVISED 2026-08-27, by maintainer decision, from 5 kB to 8 kB. Do NOT
// "restore" 5 kB thinking this is a typo: the original 5 kB figure came from
// the kickoff prompt and was never validated against an implementation.
// First real measurement (this same day, before the revision) was 7566 B
// gzip, and the dominant cost is product code (AutoSkeleton, dom-sensor,
// css-renderer standalone gzip sizes), not incidental bloat — see spec.md
// NFR-6 for the full rationale and plan.md §11 item 5 for the resolved open
// question. 8 kB remains a HARD FAILING GATE, not a downgrade to a tracked
// budget.
const NFR6_BUDGET_BYTES = 8 * 1024;

let outDir: string;
let bundlePath: string;

beforeAll(async () => {
  // Rebuild `lib/` from current `src/` so this measures today's code, not a
  // stale artifact left over from an earlier `npm pack` run elsewhere in the
  // suite.
  execFileSync('npx', ['bob', 'build'], { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' });

  const entry = path.join(repoRoot, 'lib/module/index.web.js');
  outDir = mkdtempSync(path.join(tmpdir(), 'autoskeleton-web-bundle-'));

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
      lib: {
        entry,
        formats: ['es'],
        fileName: () => 'autoskeleton.web.js',
      },
      rollupOptions: {
        // NFR-6's own text: the budget excludes React itself. A real
        // consumer app already ships react/react-dom regardless of whether
        // it uses autoskeleton, so this package's OWN incremental weight is
        // the only thing < 8 kB gzip can meaningfully describe.
        external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
      },
    },
  });

  bundlePath = path.join(outDir, 'autoskeleton.web.js');
}, 120_000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe('NFR-6: web entry gzip budget (measured on a real Vite consumer bundle)', () => {
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

  it('is under 8 kB gzip (NFR-6, failing gate per spec Open Question 5 — REVISED 2026-08-27)', () => {
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
