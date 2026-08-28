// test/web/helpers/tailwind.ts
//
// tasks.md 7.1: compiles a real Tailwind v4 entry stylesheet through the
// ACTUAL `@tailwindcss/cli` binary this repo installs as a devDependency —
// never a hand-rolled CSS string standing in for what Tailwind v4 is
// believed to output. `--skl-base`/`--skl-highlight` are asserted against
// genuine compiler output so a future Tailwind v4 behavior change (e.g. to
// `@theme` namespace handling) would break this test instead of silently
// drifting from reality.
//
// Resolves the CLI's entry script directly (via `require.resolve` on its
// `package.json`) rather than shelling out to `npx`, so compilation works
// from any cwd (including a Playwright worker) without depending on PATH or
// npm's own resolution — and stays fast: no network, no registry lookup,
// just the already-installed local binary.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

let cliEntryPath: string | undefined;

function resolveCliEntry(): string {
  if (cliEntryPath) {
    return cliEntryPath;
  }
  const pkgPath = require.resolve('@tailwindcss/cli/package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin?: Record<string, string> | string };
  const binRelative = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['tailwindcss'];
  if (!binRelative) {
    throw new Error('@tailwindcss/cli package.json has no resolvable "bin" entry');
  }
  cliEntryPath = path.join(path.dirname(pkgPath), binRelative);
  return cliEntryPath;
}

// `@import "tailwindcss"` is resolved by the Tailwind v4 compiler relative to
// the IMPORTING FILE's own path (walking up its ancestor `node_modules`
// directories), not relative to the CLI's `cwd`. A throwaway directory under
// the OS tmp root (e.g. `/tmp/...`) has no ancestor `node_modules` at all, so
// resolution fails there — confirmed empirically. Scratch files therefore
// live under a gitignored directory INSIDE the repo, where the walk-up
// reaches `<repo>/node_modules/tailwindcss`.
const REPO_ROOT = path.dirname(path.dirname(path.dirname(__dirname)));
const SCRATCH_ROOT = path.join(REPO_ROOT, '.tailwind-tmp');

/** Compiles `source` (a Tailwind v4 entry CSS file — normally starting with
 *  `@import "tailwindcss";`) through the real Tailwind v4 engine and returns
 *  the compiled CSS text. Uses a throwaway directory per call under the
 *  gitignored `.tailwind-tmp/` scratch root; nothing here is committed. */
export function compileTailwindCss(source: string): string {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  const dir = mkdtempSync(path.join(SCRATCH_ROOT, 'run-'));
  const inputPath = path.join(dir, 'in.css');
  const outputPath = path.join(dir, 'out.css');
  writeFileSync(inputPath, source, 'utf8');
  try {
    execFileSync(process.execPath, [resolveCliEntry(), '-i', inputPath, '-o', outputPath], {
      cwd: dir,
      stdio: 'pipe',
    });
    return readFileSync(outputPath, 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
