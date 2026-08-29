// benchmarks/support/lib-build.ts
//
// tasks.md G.13 — the single owner of "make sure `lib/` (the builder-bob output
// the NFR-6 gzip measurement reads) exists".
//
// WHY THIS MODULE EXISTS. `npm run bench` was structurally racy.
// `benchmarks/web-benchmarks.bench.test.ts` and `benchmarks/absolute.bench.test.ts`
// (the latter via `run.ts` -> `measureWebEntryGzip`) BOTH reached
// `ensureLibBuilt()` -> `npx bob build`, writing into the SAME `lib/` directory,
// while `vitest.bench.config.ts` had neither a `globalSetup` nor
// `fileParallelism: false`. Under Vitest's default file parallelism those two
// files run concurrently in separate workers, and one observes the other's
// mid-rebuild cleanup. Measured on a clean tree at 3aa3462: **5 of 5**
// consecutive `npm run bench` runs failed, each with `Command failed: npx bob
// build` and a DIFFERENT ENOENT victim (`lib/module/native/sensor.js.map`,
// `lib/typescript/module/cli/capture.d.ts`,
// `lib/commonjs/types/react-native-codegen-types.d.js.map`, ...) — the
// nondeterministic victim file is itself the race's signature.
//
// This is the EXACT hazard `test/packaging/global-setup.ts` already exists to
// fix for the packaging suite; that fix was simply never applied to the
// benchmark config. The fix here follows that precedent rather than inventing a
// different one: build `lib/` exactly ONCE in a `globalSetup`, which Vitest
// guarantees runs in a single process, exactly once per `vitest run`, strictly
// before ANY test file (and therefore any worker) starts, regardless of file
// parallelism or the configured worker pool. No retry, no sleep, no lock file —
// there is no second writer left to coordinate with.
//
// WHY THE SKIP IS CONDITIONAL AND NOT UNCONDITIONAL. `benchmarks/run.ts`
// (`npm run bench:run`) calls `measureWebEntryGzip()` OUTSIDE Vitest entirely —
// a plain `tsx` process. No `globalSetup` ever runs there, so nothing else
// built `lib/` and `ensureLibBuilt()` must still build it. The skip is therefore
// gated on a marker the bench `globalSetup` ACTUALLY sets (`stampLibPrebuilt`),
// never on an assumption. `benchmarks/support/lib-build.test.ts` pins both
// directions, including that the writer and the reader agree on the marker.
//
// WHY AN ENVIRONMENT VARIABLE. Vitest's `globalSetup` runs in a different global
// scope from the tests, so a module-level flag set there is invisible to
// workers. `process.env` mutations made in `globalSetup` DO reach them, because
// the setup completes before any worker is spawned — verified directly in this
// repo against both `--pool=forks` (Vitest 3's default) and `--pool=threads`.

import { execFileSync } from 'node:child_process';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** Set to `'1'` by `benchmarks/global-setup.ts` after it has built `lib/` once,
 *  strictly before any Vitest worker exists. Absent everywhere else — notably in
 *  the `npm run bench:run` CLI process, which has no globalSetup. */
export const BENCH_LIB_PREBUILT_ENV = 'AUTOSKELETON_BENCH_LIB_PREBUILT';

/** Reader half of the marker. Only the exact stamp counts: any other value is
 *  treated as "not built" and still triggers a build, so a stale or partially
 *  written variable degrades to the safe (correct-but-slower) direction rather
 *  than to a missing `lib/`. */
export function shouldBuildLib(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[BENCH_LIB_PREBUILT_ENV] !== '1';
}

/** Writer half of the marker. Called by the bench `globalSetup` immediately
 *  after its one successful build. */
export function stampLibPrebuilt(env: NodeJS.ProcessEnv = process.env): void {
  env[BENCH_LIB_PREBUILT_ENV] = '1';
}

/** Runs the real builder-bob build into `lib/`. The ONLY place in the benchmark
 *  suite that writes to `lib/` — keep it that way. */
export function buildLib(): void {
  execFileSync('npx', ['bob', 'build'], { cwd: REPO_ROOT, stdio: 'pipe' });
}

/** Builds `lib/` unless the bench `globalSetup` already did it for this run.
 *  Under `npm run bench` this is a no-op in every worker; under
 *  `npm run bench:run` (no Vitest, no globalSetup) it performs the build. */
export function ensureLibBuilt(): void {
  if (!shouldBuildLib()) {
    return;
  }
  buildLib();
}
