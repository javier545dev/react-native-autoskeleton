// benchmarks/support/web-benchmarks.ts
//
// tasks.md 9.1 — the two web-side benchmarks: DOM sensor traversal cost at
// the 30/60-shape reference screens, and the NFR-6 consumer-bundle gzip
// size. Both run against REAL artifacts: a real headless Chromium page
// running the real production `createDomSensor()` (same harness pattern as
// `test/web/dom-sensor.spec.ts`), and — for NFR-6 — literally the SAME
// measurement function the failing gate uses, imported from
// `test/packaging/helpers/web-bundle.ts`. Never a reimplementation or a
// synthetic stand-in number.
//
// It used to be a reimplementation, and that is exactly how it drifted: this
// file kept a Vite LIBRARY build after `test/packaging/web-bundle.test.ts`
// corrected its own measurement to an app build (4dae7c0), so one NFR was
// reported two ways — 9418 B here against a stale 9216 B budget, 7712 B
// against 7933 B there. Same requirement, 1706 bytes apart, both green.
//
// This module is intentionally NOT run by the fast default `npm test` suite
// (it launches a browser and runs a Vite build) — see `vitest.bench.config.ts`.

import path from 'node:path';
import { chromium } from '@playwright/test';
import { bundleEntry } from '../../test/web/helpers/bundle';
import { measureWebEntryAsConsumerApp } from '../../test/packaging/helpers/web-bundle';
import { buildReferenceScreenHtml } from '../web/reference-screen';
import { ensureLibBuilt } from './lib-build';
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

export interface WebEntryGzipResult {
  readonly rawBytes: number;
  readonly gzipBytes: number;
}

/** The NFR-6 consumer-bundle gzip size, measured by the SAME function the
 *  failing gate in `test/packaging/web-bundle.test.ts` uses. Not "the same
 *  approach as" — the same code. The previous copy of this measurement is why
 *  `budgets.json`'s own warning that the two "must be changed together or they
 *  will silently diverge" came true.
 *
 *  tasks.md G.13: under `npm run bench` the `ensureLibBuilt()` below is a
 *  deliberate NO-OP — `benchmarks/global-setup.ts` already built `lib/` once,
 *  before any worker existed. It still performs a real build under
 *  `npm run bench:run`, which runs outside Vitest and has no globalSetup. */
export async function measureWebEntryGzip(): Promise<WebEntryGzipResult> {
  ensureLibBuilt();
  const bundle = await measureWebEntryAsConsumerApp();
  try {
    return { rawBytes: bundle.rawBytes, gzipBytes: bundle.gzipBytes };
  } finally {
    bundle.cleanup();
  }
}
