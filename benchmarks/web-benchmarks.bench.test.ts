// benchmarks/web-benchmarks.bench.test.ts — RED first (tasks.md 9.1).
//
// Runs in the SEPARATE `vitest.bench.config.ts` project (launches a real
// browser + a real Vite build; deliberately excluded from the fast default
// `npm test`). Run in isolation: `npx vitest run -c vitest.bench.config.ts`.

import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { benchmarkWebSensorTraversal, measureWebEntryGzip } from './support/web-benchmarks';

const REPO_ROOT = path.resolve(__dirname, '..');

describe('benchmarkWebSensorTraversal', () => {
  it(
    'measures exactly 30 detected shapes at the 30-shape reference screen',
    async () => {
      const result = await benchmarkWebSensorTraversal({ shapeCount: 30, iterations: 20 });
      expect(result.measuredShapeCount).toBe(30);
      expect(result.samples).toHaveLength(20);
    },
    30_000,
  );

  it(
    'measures exactly 60 detected shapes at the 60-shape reference screen',
    async () => {
      const result = await benchmarkWebSensorTraversal({ shapeCount: 60, iterations: 20 });
      expect(result.measuredShapeCount).toBe(60);
    },
    30_000,
  );
});

describe('measureWebEntryGzip', () => {
  it(
    'produces a positive gzip size measured on the real consumer bundle',
    async () => {
      const result = await measureWebEntryGzip();
      expect(result.gzipBytes).toBeGreaterThan(0);
      expect(result.rawBytes).toBeGreaterThan(result.gzipBytes);
    },
    60_000,
  );

  // tasks.md G.13 — the race gate itself, asserted BEHAVIOURALLY inside a real
  // bench worker rather than by reading the config. `npx bob build` empties its
  // target output directories (verified directly: `touch
  // lib/module/__probe__.txt` then `npx bob build` deletes it, while a file at
  // `lib/` root survives — which is why this marker lives in `lib/module/`, the
  // same place `test/packaging/global-setup.ts`'s own precedent probe used).
  //
  // So: a marker placed here that does NOT survive `measureWebEntryGzip()` is
  // direct proof that this worker rebuilt `lib/` — the exact concurrent write
  // that made `npm run bench` fail 5 of 5 consecutive runs at 3aa3462. The
  // bench `globalSetup` already built `lib/` once before any worker started;
  // nothing in a worker may write to it again.
  it(
    'does not rebuild lib/ inside a Vitest worker — the bench globalSetup already built it exactly once',
    async () => {
      const marker = path.join(REPO_ROOT, 'lib/module/__bench_no_rebuild_marker__.txt');
      writeFileSync(marker, 'tasks.md G.13 single-build guarantee probe\n');
      try {
        await measureWebEntryGzip();

        expect(
          existsSync(marker),
          '`measureWebEntryGzip()` rebuilt `lib/` from inside a Vitest worker. The globalSetup single-build guarantee is broken, so two bench workers can write `lib/` concurrently again — that is the `Command failed: npx bob build` / ENOENT race, back.',
        ).toBe(true);
      } finally {
        rmSync(marker, { force: true });
      }
    },
    60_000,
  );
});
