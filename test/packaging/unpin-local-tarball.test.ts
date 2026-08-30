// test/packaging/unpin-local-tarball.test.ts
//
// Gate for `scripts/unpin-local-tarball.mjs`.
//
// THE PROBLEM IT SOLVES. `examples/*/package-lock.json` records `integrity`
// for `autoskeleton@file:../../.tarball/autoskeleton-0.1.0.tgz`. That hash is
// not a supply-chain pin — it is a hash of THIS repository's own `npm pack`
// output, produced by the `prepare` script from `src/`. It is true only for as
// long as nobody changes a source file, and keeping it true means repacking
// and hand-syncing four tracked lockfiles after every change (the repository
// already carries a commit whose entire content is doing exactly that). It had
// already drifted: `examples/expo` pinned a pre-repack hash, so `docs.yml`
// died with `npm error code EINTEGRITY` on a runner whose own tarball was byte
// for byte the right one.
//
// THE FIX. Drop the local-tarball entry before installing, so npm derives the
// integrity from the bytes actually on disk. Nothing is weakened: npm still
// hashes what it installs, and every third-party dependency keeps its real
// registry pin. The only thing removed is a promise about a build output that
// no build can keep.
//
// WHY THIS DRIVES THE REAL CLI RATHER THAN IMPORTING THE FUNCTION. CI runs
// `node scripts/unpin-local-tarball.mjs examples/<app>` on a bare checkout
// with no `npm ci` behind it. Spawning the same command is what proves that
// invocation works — including argument handling and the zero-dependency
// constraint — instead of proving that an exported function works when a
// bundler loads it.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/unpin-local-tarball.mjs');

const created: string[] = [];

afterEach(() => {
  while (created.length > 0) {
    rmSync(created.pop()!, { recursive: true, force: true });
  }
});

/** Writes a package-lock.json in npm's own shape (two-space, trailing newline)
 *  and returns the directory holding it. */
function exampleWith(packages: Record<string, unknown>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'autoskeleton-unpin-'));
  created.push(dir);
  writeFileSync(
    path.join(dir, 'package-lock.json'),
    `${JSON.stringify({ name: 'example', lockfileVersion: 3, requires: true, packages }, null, 2)}\n`,
  );
  return dir;
}

function unpin(...args: string[]): string {
  return execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
}

function lockOf(dir: string): { packages: Record<string, Record<string, unknown> | undefined> } {
  return JSON.parse(readFileSync(path.join(dir, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, Record<string, unknown> | undefined>;
  };
}

describe('node scripts/unpin-local-tarball.mjs <example>', () => {
  it('removes the entry for a dependency resolved from a local .tgz', () => {
    const dir = exampleWith({
      '': { name: 'example', dependencies: { autoskeleton: 'file:../../.tarball/autoskeleton-0.1.0.tgz' } },
      'node_modules/autoskeleton': {
        version: '0.1.0',
        resolved: 'file:../../.tarball/autoskeleton-0.1.0.tgz',
        integrity: 'sha512-stale',
      },
    });

    const stdout = unpin(dir);

    expect(stdout).toContain('unpinned node_modules/autoskeleton');
    expect(lockOf(dir).packages['node_modules/autoskeleton']).toBeUndefined();
  });

  it("leaves the root entry — and therefore package.json's own spec — untouched", () => {
    const dir = exampleWith({
      '': { name: 'example', dependencies: { autoskeleton: 'file:../../.tarball/autoskeleton-0.1.0.tgz' } },
      'node_modules/autoskeleton': { version: '0.1.0', resolved: 'file:../../.tarball/x.tgz', integrity: 'sha512-a' },
    });

    unpin(dir);

    expect(lockOf(dir).packages['']?.dependencies).toEqual({
      autoskeleton: 'file:../../.tarball/autoskeleton-0.1.0.tgz',
    });
  });

  it('never touches a registry dependency, however similar its name', () => {
    const dir = exampleWith({
      '': { name: 'example' },
      'node_modules/autoskeleton-ui': {
        version: '1.0.0',
        resolved: 'https://registry.npmjs.org/autoskeleton-ui/-/autoskeleton-ui-1.0.0.tgz',
        integrity: 'sha512-real',
      },
    });

    const stdout = unpin(dir);

    expect(stdout).toContain('no local-tarball lockfile entries to unpin');
    expect(lockOf(dir).packages['node_modules/autoskeleton-ui']?.integrity).toBe('sha512-real');
  });

  it('leaves a linked local DIRECTORY dependency alone — only tarball hashes are the problem', () => {
    const dir = exampleWith({
      '': { name: 'example' },
      'node_modules/linked': { resolved: '../../packages/linked', link: true },
    });

    unpin(dir);

    expect(lockOf(dir).packages['node_modules/linked']).toBeDefined();
  });

  it('is idempotent: a second run removes nothing and rewrites nothing', () => {
    const dir = exampleWith({
      '': { name: 'example' },
      'node_modules/autoskeleton': { resolved: 'file:../../.tarball/a.tgz', integrity: 'sha512-a' },
    });

    unpin(dir);
    const afterFirst = readFileSync(path.join(dir, 'package-lock.json'), 'utf8');
    const stdout = unpin(dir);

    expect(stdout).toContain('no local-tarball lockfile entries to unpin');
    expect(readFileSync(path.join(dir, 'package-lock.json'), 'utf8')).toBe(afterFirst);
  });

  it('exits 0 for an example that has no lockfile yet, instead of breaking the install step', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'autoskeleton-unpin-empty-'));
    created.push(dir);

    expect(() => unpin(dir)).not.toThrow();
  });

  it("preserves npm's two-space JSON formatting and trailing newline", () => {
    const dir = exampleWith({
      '': { name: 'example' },
      'node_modules/autoskeleton': { resolved: 'file:../../.tarball/a.tgz', integrity: 'sha512-a' },
    });

    unpin(dir);
    const text = readFileSync(path.join(dir, 'package-lock.json'), 'utf8');

    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "lockfileVersion": 3,');
  });

  it('runs with zero dependencies resolved from node_modules', () => {
    // CI invokes this on a bare checkout, before (and sometimes without) any
    // `npm ci`. `--no-addons` is irrelevant here; what matters is that the
    // module graph is `node:` builtins only, which this asserts directly.
    const source = readFileSync(SCRIPT, 'utf8');
    const specifiers = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((match) => match[1]);

    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier, `${specifier} is not a node: builtin`).toMatch(/^node:/);
    }
  });
});

describe('the repository state this script exists for', () => {
  // Not a hypothetical. Asserting the real files keeps the rationale honest:
  // if someone later drops these pins for good, this says so out loud rather
  // than leaving a script guarding nothing.
  it('every example lockfile still resolves autoskeleton from a local tarball', () => {
    for (const example of ['bare-rn', 'expo', 'next', 'vite']) {
      const lock = JSON.parse(
        readFileSync(path.join(REPO_ROOT, 'examples', example, 'package-lock.json'), 'utf8'),
      ) as { packages: Record<string, { resolved?: string } | undefined> };
      expect(lock.packages['node_modules/autoskeleton']?.resolved, example).toMatch(/^file:.*\.tgz$/);
    }
  });
});
