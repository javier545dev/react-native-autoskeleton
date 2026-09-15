import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// No committed lockfile may pin the integrity of this repo's OWN tarball.
//
// `scripts/unpin-local-tarball.mjs` already argues the case in full: an
// `integrity` hash exists to pin an artifact the project does not control, and
// `autoskeleton@file:../../.tarball/autoskeleton-0.1.0.tgz` is this
// repository's own `npm pack` output from moments earlier. Pinning it
// guarantees nothing about provenance and instead asserts something no build
// can promise — that the library will re-pack to exactly these bytes. Every
// source edit falsifies it.
//
// WHY A TEST AND NOT JUST THE SCRIPT. The script was only ever wired into CI,
// where every workflow runs it before installing. Local development never
// touched it, so the committed pins drifted anyway: at the time this file was
// written, three of the five examples pinned hashes belonging to two DIFFERENT
// historical tarballs, none of them current. The failure mode is silent —
// `npm ci` gives a loud EINTEGRITY, but plain `npm install` reports "up to
// date", exits 0, and leaves the OLD bytes installed. An example app then runs
// stale library code while appearing healthy, which has already cost this
// project a debugging session.
//
// This gate turns that from a chore someone must remember into a state the
// repository cannot be committed in.

const REPO_ROOT = path.resolve(__dirname, '../..');
const EXAMPLES_DIR = path.join(REPO_ROOT, 'examples');

interface Lockfile {
  readonly packages?: Record<string, { resolved?: string; integrity?: string; link?: boolean }>;
}

const exampleLockfiles = readdirSync(EXAMPLES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join('examples', entry.name, 'package-lock.json'))
  .filter((relative) => existsSync(path.join(REPO_ROOT, relative)))
  .sort();

/** Every lockfile entry installed from a LOCAL `.tgz`.
 *
 *  The `file:` prefix is the whole discriminator and it is not optional: a
 *  registry dependency's `resolved` is an https URL that also ends in `.tgz`,
 *  so matching on the extension alone sweeps in all ~1,500 of them — every one
 *  of which SHOULD keep its integrity pin, because those are the
 *  supply-chain guarantees this gate exists to leave untouched.
 *
 *  A linked local DIRECTORY (`link: true`) is excluded too: it carries no
 *  integrity by construction, which is precisely why it is an acceptable
 *  alternative shape to the tarball. */
function localTarballEntries(relative: string): Array<[string, { resolved?: string; integrity?: string }]> {
  const lock = JSON.parse(readFileSync(path.join(REPO_ROOT, relative), 'utf8')) as Lockfile;
  return Object.entries(lock.packages ?? {}).filter(
    ([, entry]) =>
      entry.link !== true &&
      typeof entry.resolved === 'string' &&
      entry.resolved.startsWith('file:') &&
      entry.resolved.endsWith('.tgz')
  );
}

describe('no committed lockfile pins the integrity of our own packed tarball', () => {
  it('there are example lockfiles to check (guards against this suite silently checking nothing)', () => {
    expect(exampleLockfiles.length).toBeGreaterThan(0);
  });

  it.each(exampleLockfiles)('%s carries no integrity for a local .tgz dependency', (relative) => {
    const pinned = localTarballEntries(relative)
      .filter(([, entry]) => typeof entry.integrity === 'string')
      .map(([name]) => name);

    expect(
      pinned,
      `${relative} pins the integrity of a locally packed tarball (${pinned.join(', ')}). ` +
        'That hash is a prediction about this repo\'s own build output, and every source edit falsifies it. ' +
        'Run `node scripts/unpin-local-tarball.mjs` and commit the result.'
    ).toHaveLength(0);
  });
});
