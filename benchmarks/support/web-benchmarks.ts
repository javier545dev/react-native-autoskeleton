// benchmarks/support/web-benchmarks.ts
//
// tasks.md 9.1 — the two web-side benchmarks: DOM sensor traversal cost at
// the 30/60-shape reference screens, and the NFR-6 consumer-bundle gzip
// size. Both run against REAL artifacts: a real headless Chromium page
// running the real production `createDomSensor()` (same harness pattern as
// `test/web/dom-sensor.spec.ts`), and a real Vite library-mode build of the
// real `lib/module/index.web.js` builder-bob output (same approach as
// `test/packaging/web-bundle.test.ts`) — never a reimplementation or a
// synthetic stand-in number.
//
// This module is intentionally NOT run by the fast default `npm test` suite
// (it launches a browser and runs a Vite build) — see `vitest.bench.config.ts`.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';
import { bundleEntry } from '../../test/web/helpers/bundle';
import { buildReferenceScreenHtml } from '../web/reference-screen';
import { percentile } from './percentiles';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DOM_SENSOR_ENTRY = path.join(REPO_ROOT, 'test/web/helpers/dom-sensor-entry.ts');

export interface WebSensorTraversalBenchmarkOptions {
  readonly shapeCount: number;
  readonly iterations: number;
}

export interface WebSensorTraversalBenchmarkResult {
  readonly samples: readonly number[];
  readonly p95Ms: number;
  readonly measuredShapeCount: number;
}

/** Runs the REAL production DOM sensor `iterations` times against a real
 *  `shapeCount`-shape page, inside one headless Chromium instance, and
 *  returns the sensor's OWN reported `traversalMs` per run (not a
 *  page.evaluate() round-trip time, which would include IPC noise the
 *  production traversal itself never pays). */
export async function benchmarkWebSensorTraversal(
  options: WebSensorTraversalBenchmarkOptions,
): Promise<WebSensorTraversalBenchmarkResult> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 900 } });
    await page.setContent(`<!doctype html><html><body>${buildReferenceScreenHtml(options.shapeCount)}</body></html>`, {
      waitUntil: 'load',
    });
    const bundle = await bundleEntry(DOM_SENSOR_ENTRY);
    await page.addScriptTag({ content: bundle });

    const { samples, measuredShapeCount } = await page.evaluate(
      ({ iterations }) => {
        const { createDomSensor, createEmptyHintRegistry, composeCacheKey, decodeWire } = window.Autoskeleton;
        const sensor = createDomSensor!();
        const root = document.getElementById('root')!;
        const key = composeCacheKey!({
          skeletonKey: 'benchmarks/reference-screen',
          viewportWidth: 400,
          fontScale: 1,
          direction: 'ltr',
          platform: 'web',
        });
        const out: number[] = [];
        let lastShapeCount = 0;
        for (let i = 0; i < iterations; i++) {
          const result = sensor.measure(root, {
            key,
            hints: createEmptyHintRegistry!(),
            budgetMs: 50,
            maxShapes: 200,
            defaultRadius: 4,
            collectDebugSidecars: false,
          });
          if (result) {
            out.push(result.traversalMs);
            lastShapeCount = decodeWire!(result.snapshot.data).shapes.length;
          }
        }
        return { samples: out, measuredShapeCount: lastShapeCount };
      },
      { iterations: options.iterations },
    );

    return { samples, p95Ms: percentile(samples, 95), measuredShapeCount };
  } finally {
    await browser.close();
  }
}

function ensureLibBuilt(): void {
  execFileSync('npx', ['bob', 'build'], { cwd: REPO_ROOT, stdio: 'pipe' });
}

export interface WebEntryGzipResult {
  readonly rawBytes: number;
  readonly gzipBytes: number;
}

/** Same measurement approach as `test/packaging/web-bundle.test.ts`'s NFR-6
 *  gate: a real Vite library-mode build of `lib/module/index.web.js` with
 *  `react`/`react-dom` external, minified, gzip-measured. Kept as its own
 *  small re-measurement here (rather than importing that test file) so the
 *  benchmark suite has no dependency on Vitest's test lifecycle. */
export async function measureWebEntryGzip(): Promise<WebEntryGzipResult> {
  ensureLibBuilt();
  const entry = path.join(REPO_ROOT, 'lib/module/index.web.js');
  if (!existsSync(entry)) {
    throw new Error(`Expected ${entry} after 'bob build' — builder-bob output is missing.`);
  }

  const outDir = mkdtempSync(path.join(tmpdir(), 'autoskeleton-bench-web-bundle-'));
  try {
    const { build } = await import('vite');
    await build({
      root: REPO_ROOT,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      build: {
        outDir,
        emptyOutDir: true,
        minify: 'esbuild',
        sourcemap: false,
        lib: { entry, formats: ['es'], fileName: () => 'autoskeleton.web.js' },
        rollupOptions: {
          external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
        },
      },
    });
    const bundlePath = path.join(outDir, 'autoskeleton.web.js');
    const source = readFileSync(bundlePath);
    const gzipped = gzipSync(source, { level: 9 });
    return { rawBytes: source.length, gzipBytes: gzipped.length };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}
