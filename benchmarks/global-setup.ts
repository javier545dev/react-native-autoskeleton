// benchmarks/global-setup.ts
//
// tasks.md G.13 — the benchmark suite's counterpart to
// `test/packaging/global-setup.ts`, for the identical structural hazard that
// file's doc comment already describes: two test files independently running
// `npx bob build` into the SAME `lib/` directory, concurrently, under Vitest's
// default file parallelism.
//
// In the benchmark suite the two writers were `web-benchmarks.bench.test.ts`
// and `absolute.bench.test.ts` (via `run.ts` -> `measureWebEntryGzip` ->
// `ensureLibBuilt`). Unlike the packaging case, this one was not a
// flagged-but-unobserved hazard: on a clean tree at 3aa3462 it failed **5 of 5**
// consecutive `npm run bench` runs.
//
// Vitest guarantees `globalSetup` runs in a single process, exactly once per
// `vitest run` invocation, strictly before ANY test file (and therefore any
// worker) starts. Building here and stamping the environment is what makes the
// single build a structural property of the run rather than a timing accident.
// See `benchmarks/support/lib-build.ts` for the full reasoning, including why
// the resulting skip must stay conditional so `npm run bench:run` still builds.

import { buildLib, stampLibPrebuilt } from './support/lib-build';

export default function setup(): void {
  buildLib();
  // Only stamp AFTER a successful build: if `buildLib()` throws, the run fails
  // loudly here (in one process, with the real error) instead of handing every
  // worker a "someone else already built it" promise that nobody kept.
  stampLibPrebuilt();
}
