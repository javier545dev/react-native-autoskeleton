import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
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
//
// tasks.md 7.4 CORRECTION (this session — the ORIGINAL premise below about
// `npm pack --ignore-scripts` was empirically WRONG, discovered when a second
// file, `interop-exports.test.ts`, started doing the exact same `npm pack
// --ignore-scripts` dance concurrently with `entries.test.ts` and hit the
// EXACT race this doc comment already predicted): `--ignore-scripts` does
// NOT suppress `npm pack`'s `prepare` lifecycle script in this npm version —
// verified directly (`touch lib/module/__marker__.txt; npm pack
// --ignore-scripts ...` deletes the marker, proving `bob build` ran again).
// So the ORIGINAL claim "`entries.test.ts` still needs a REAL `npm pack`
// ... but now packs with `--ignore-scripts` so `npm pack` does not
// re-trigger the `prepare` script" was never actually true — it just never
// got EXERCISED concurrently by a second packer until this session added
// one. The real, structural fix (matching this file's own "build lib/
// exactly once, in a single globalSetup process" precedent) is to also pack
// AND extract the tarball exactly ONCE here, so every packaging test file
// that needs to inspect the published artifact (`entries.test.ts`,
// `interop-exports.test.ts`) reads the SAME already-extracted directory
// instead of each independently invoking `npm pack` (and therefore, it
// turns out, `bob build`) in its own `beforeAll`.
const repoRoot = path.resolve(__dirname, '../..');
export const PACK_EXTRACT_DIR = path.join(repoRoot, '.pack-tmp', 'package');

export default async function setup(): Promise<() => Promise<void>> {
  execFileSync('npx', ['bob', 'build'], { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' });

  const packRoot = path.join(repoRoot, '.pack-tmp');
  rmSync(packRoot, { recursive: true, force: true });
  mkdirSync(packRoot, { recursive: true });

  // `--ignore-scripts` is kept even though it does not actually suppress
  // `prepare` here (see above) — it is still correct intent, costs nothing,
  // and a future npm version honoring it correctly should not need this
  // comment revisited.
  execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', packRoot], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const [filename] = readdirSync(packRoot).filter((f) => f.endsWith('.tgz'));
  if (!filename) {
    throw new Error(`npm pack did not produce a .tgz file in ${packRoot}`);
  }
  execFileSync('tar', ['-xzf', path.join(packRoot, filename), '-C', packRoot]);
  if (!existsSync(PACK_EXTRACT_DIR)) {
    throw new Error(`Expected extracted package directory at ${PACK_EXTRACT_DIR}, found nothing`);
  }

  return async () => {
    rmSync(packRoot, { recursive: true, force: true });
  };
}
