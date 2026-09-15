#!/usr/bin/env node
// scripts/unpin-local-tarball.mjs
//
// Removes the `package-lock.json` entry for any dependency resolved from a
// LOCAL tarball (`file:` + `.tgz`), so the next `npm install` re-derives its
// integrity from the bytes actually on disk.
//
// ── Why a committed integrity hash is wrong for this one dependency ─────────
//
// `integrity` in a lockfile exists to pin an artifact this project does not
// control: fetch `left-pad@1.3.0` from any registry mirror, on any machine, in
// any year, and the hash must be that hash. That is a supply-chain guarantee,
// and it is worth defending.
//
// `autoskeleton@file:../../.tarball/autoskeleton-0.1.0.tgz` is not that. It is
// THIS repository's own `npm pack` output, produced by the `prepare` script
// from `src/` moments earlier. Pinning its hash guarantees nothing about
// provenance — the bytes came from the working tree the lockfile lives in —
// and instead asserts something no build can promise: "the library will
// re-pack to exactly these bytes". Every source edit falsifies it. Keeping it
// true means repacking and hand-syncing four tracked lockfiles after every
// change; this repository already carries a commit whose entire content is
// that chore, and it still drifted — `examples/expo` pinned a pre-repack hash,
// so `docs.yml` died with EINTEGRITY on a runner whose own tarball was byte
// for byte the right one.
//
// It also inverts the dependency: a lockfile is supposed to constrain what
// gets installed, not to gate whether `src/` is allowed to change.
//
// ── What this does NOT weaken ───────────────────────────────────────────────
//
// Every registry dependency keeps its real pin — only entries whose `resolved`
// is a local `file:` tarball are touched, and a linked local DIRECTORY is left
// alone too. npm still hashes what it installs; it simply derives the hash
// instead of comparing it against a stale prediction. And the installed bytes
// are the exact bytes the run under way just packed, which is a stronger
// guarantee than the pin ever gave: an artifact from this run, rather than one
// that happened to match a number a human last refreshed by hand.
//
// ── Why plain `.mjs` and no dependencies ────────────────────────────────────
//
// It runs on a bare `actions/checkout` with no `npm ci` behind it (the example
// jobs never install the root workspace), so it must not need tsx, esbuild, or
// anything else from `node_modules`.
//
// Usage (no arguments = every package-lock.json under `examples/`):
//   node scripts/unpin-local-tarball.mjs
//   node scripts/unpin-local-tarball.mjs examples/next examples/vite

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A dependency npm fetched from a tarball sitting on this filesystem. The
 * `link` guard keeps a `file:` DIRECTORY dependency (a symlink, which carries
 * no integrity at all) out of scope — this is only about hashes of build
 * outputs.
 *
 * @param {{ resolved?: string, link?: boolean }} entry
 * @returns {boolean}
 */
function isLocalTarball(entry) {
  return (
    entry.link !== true &&
    typeof entry.resolved === 'string' &&
    entry.resolved.startsWith('file:') &&
    entry.resolved.endsWith('.tgz')
  );
}

/**
 * @param {readonly string[]} lockfilePaths
 * @returns {{ removed: Array<{ lockfile: string, entries: string[] }>, skipped: string[] }}
 *   `removed` has one entry per lockfile actually rewritten. `skipped` lists
 *   lockfiles that do not exist, which is not an error: a workflow may unpin a
 *   set of examples before knowing which ones it will install.
 */
export function unpinLocalTarballs(lockfilePaths) {
  const removed = [];
  const skipped = [];

  for (const lockfile of lockfilePaths) {
    if (!existsSync(lockfile)) {
      skipped.push(lockfile);
      continue;
    }

    const json = JSON.parse(readFileSync(lockfile, 'utf8'));
    const packages = json.packages ?? {};
    // The root entry (key `""`) mirrors package.json's own dependency SPEC,
    // never a hash — leaving it in place is what keeps `npm install` able to
    // resolve the tarball again.
    const entries = Object.entries(packages)
      .filter(([key, entry]) => key !== '' && isLocalTarball(entry))
      .map(([key]) => key);

    if (entries.length === 0) {
      // Rewriting an unchanged file would churn a tracked artifact for no
      // reason and make the script non-idempotent in `git status`.
      continue;
    }

    for (const key of entries) {
      delete packages[key];
    }
    writeFileSync(lockfile, `${JSON.stringify(json, null, 2)}\n`);
    removed.push({ lockfile, entries });
  }

  return { removed, skipped };
}

/**
 * The `package-lock.json` of every directory under `examples/`, in a stable
 * order.
 *
 * @param {string} [repoRoot]
 * @returns {string[]}
 */
export function defaultLockfiles(repoRoot = REPO_ROOT) {
  const examplesDir = path.join(repoRoot, 'examples');
  if (!existsSync(examplesDir)) return [];
  return readdirSync(examplesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(examplesDir, entry.name, 'package-lock.json'))
    .filter((lockfile) => existsSync(lockfile))
    .sort();
}

function main() {
  const args = process.argv.slice(2);
  const lockfiles =
    args.length === 0
      ? defaultLockfiles()
      : args.map((arg) =>
          arg.endsWith('package-lock.json') ? path.resolve(arg) : path.resolve(arg, 'package-lock.json'),
        );

  const result = unpinLocalTarballs(lockfiles);
  for (const { lockfile, entries } of result.removed) {
    // eslint-disable-next-line no-console
    console.log(
      `unpinned ${entries.join(', ')} in ${path.relative(REPO_ROOT, lockfile)} ` +
        '(local build output — npm will re-derive the integrity from the packed bytes)',
    );
  }
  if (result.removed.length === 0) {
    // eslint-disable-next-line no-console
    console.log('no local-tarball lockfile entries to unpin');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
