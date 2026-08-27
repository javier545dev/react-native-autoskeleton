import { execFileSync } from 'node:child_process';
import path from 'node:path';

// PRE-TASK (Phase 3 apply session, orchestrator-flagged structural hazard, not an
// observed failure): `test/packaging/entries.test.ts` and
// `test/packaging/web-bundle.test.ts` each independently ran `bob build` (directly,
// or transitively via `npm pack`'s `prepare` lifecycle script) in their own
// `beforeAll`, both writing to the SAME `lib/` directory. Under Vitest's default
// file parallelism, those two files can run concurrently in separate workers, and
// one can observe `lib/` mid-rebuild by the other — an intermittent ENOENT from a
// concurrent cleanup/rewrite. Three consecutive local runs did not reproduce it
// (this machine's timing happened to stay clear), but the hazard is real and
// structural, not timing-dependent luck: CI is a different machine with a cold
// cache and different scheduling, and a gate that flakes under different timing is
// a gate someone eventually disables.
//
// Fix: build `lib/` from `src/` exactly ONCE, in Vitest's `globalSetup` — which
// Vitest guarantees runs in a single process, exactly once per `vitest run`
// invocation, strictly before ANY test file (and therefore any worker) starts,
// regardless of file parallelism or the configured worker pool. After this point,
// nothing else in the packaging suite writes to `lib/`:
// - `web-bundle.test.ts` no longer runs `bob build` itself — it just reads the
//   `lib/module/index.web.js` this setup already produced.
// - `entries.test.ts` still needs a REAL `npm pack` (to exercise the actual
//   `files` glob / tarball contents, not just `lib/`'s existence), but now packs
//   with `--ignore-scripts` so `npm pack` does not re-trigger the `prepare` script
//   (which would otherwise rebuild `lib/` a second time, redundantly and, if any
//   future test file were added alongside it, racily again). `npm pack
//   --ignore-scripts` only READS `lib/` and the rest of the source tree; it never
//   writes to it.
//
// Explicitly NOT the fix: pinning `--no-file-parallelism` in vitest.config.ts.
// That would hide the coupling (the two files would still both be ABLE to write to
// `lib/` concurrently, just never observed to because nothing else ever runs at
// the same time) and slow down the whole suite for every unrelated test file too.
export default async function setup(): Promise<void> {
  const repoRoot = path.resolve(__dirname, '../..');
  execFileSync('npx', ['bob', 'build'], { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' });
}
