// benchmarks/support/lib-build.test.ts — RED first (tasks.md G.13).
//
// `npm run bench` was structurally racy: `benchmarks/web-benchmarks.bench.test.ts`
// and `benchmarks/absolute.bench.test.ts` (the latter via `run.ts` ->
// `measureWebEntryGzip`) BOTH called `ensureLibBuilt()` -> `npx bob build` into
// the SAME `lib/` directory, while `vitest.bench.config.ts` had neither a
// `globalSetup` nor `fileParallelism: false`. Under Vitest's default file
// parallelism the two workers rebuilt `lib/` concurrently and one observed the
// other's mid-rebuild cleanup — a `Command failed: npx bob build` with a
// DIFFERENT ENOENT victim file every time. Measured on a clean tree at 3aa3462:
// 5 of 5 consecutive `npm run bench` runs failed.
//
// The fix matches this repo's OWN precedent (`test/packaging/global-setup.ts`,
// which exists for the identical hazard in the packaging suite): build `lib/`
// exactly ONCE in a `globalSetup`, which Vitest guarantees runs in a single
// process, exactly once per `vitest run`, strictly before ANY worker starts.
//
// The skip MUST stay CONDITIONAL, never unconditional: `benchmarks/run.ts`
// (`npm run bench:run`) calls `measureWebEntryGzip()` OUTSIDE Vitest entirely,
// so no `globalSetup` ever runs for it and nothing else built `lib/`. These
// tests pin exactly that asymmetry — and, critically, that the stamp the setup
// WRITES is the same one `ensureLibBuilt()` READS (a marker the two halves
// disagreed about would silently restore the race, or silently break the CLI).

import { describe, expect, it } from 'vitest';
import { BENCH_LIB_PREBUILT_ENV, shouldBuildLib, stampLibPrebuilt } from './lib-build';

describe('shouldBuildLib — the conditional that keeps `npm run bench:run` working', () => {
  it('builds when nothing stamped the environment (the `npm run bench:run` CLI path)', () => {
    // No Vitest, therefore no `globalSetup`, therefore no prebuilt `lib/`.
    expect(shouldBuildLib({})).toBe(true);
  });

  it('skips the build when the bench globalSetup already stamped the environment', () => {
    expect(shouldBuildLib({ [BENCH_LIB_PREBUILT_ENV]: '1' })).toBe(false);
  });

  it('builds for any value other than the exact stamp (a stale/partial marker is not a build)', () => {
    expect(shouldBuildLib({ [BENCH_LIB_PREBUILT_ENV]: '' })).toBe(true);
    expect(shouldBuildLib({ [BENCH_LIB_PREBUILT_ENV]: '0' })).toBe(true);
    expect(shouldBuildLib({ [BENCH_LIB_PREBUILT_ENV]: 'true' })).toBe(true);
  });
});

describe('stampLibPrebuilt — writer and reader must agree', () => {
  it('writes exactly the marker `shouldBuildLib` reads, so the setup can actually suppress the rebuild', () => {
    const env: NodeJS.ProcessEnv = {};
    expect(shouldBuildLib(env)).toBe(true);

    stampLibPrebuilt(env);

    expect(shouldBuildLib(env)).toBe(false);
  });

  it('does not disturb the ambient process environment when given an explicit target', () => {
    const before = process.env[BENCH_LIB_PREBUILT_ENV];
    stampLibPrebuilt({});
    expect(process.env[BENCH_LIB_PREBUILT_ENV]).toBe(before);
  });
});
