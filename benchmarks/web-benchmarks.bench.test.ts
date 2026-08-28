// benchmarks/web-benchmarks.bench.test.ts — RED first (tasks.md 9.1).
//
// Runs in the SEPARATE `vitest.bench.config.ts` project (launches a real
// browser + a real Vite build; deliberately excluded from the fast default
// `npm test`). Run in isolation: `npx vitest run -c vitest.bench.config.ts`.

import { describe, expect, it } from 'vitest';
import { benchmarkWebSensorTraversal, measureWebEntryGzip } from './support/web-benchmarks';

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
});
