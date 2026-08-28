// test/packaging/interop-exports.test.ts
//
// tasks.md 7.4: both theming interops (`autoskeleton/uniwind`,
// `autoskeleton/nativewind`, tasks 7.2/7.3) must be tree-shakeable subpath
// exports, never imported by any default entry (`index.native.js`/
// `index.web.js`/`index.js`). Extends the RISK-5 packaging detector's own
// infrastructure (`./helpers/resolve.ts`, extracted from
// `test/packaging/entries.test.ts` this session) rather than building a
// parallel one, per this session's explicit instruction.
//
// NON-VACUOUSNESS, taken seriously (this session's explicit brief item): an
// assertion of the shape "X does not appear in Y's import graph" passes
// trivially if X doesn't exist, or if nothing could ever reach it. This was
// established as genuinely non-vacuous by TEMPORARILY adding one throwaway
// re-export of `./interop/uniwind` to `src/index.native.ts`, rebuilding, and
// confirming the "zero transitive dependency" test below actually failed —
// citing the exact interop file it found in the walked graph — before
// reverting that throwaway change and confirming GREEN again. See the
// apply-progress record / tasks.md 7.4 entry for the exact commands and
// failure output from that proof run.
//
// Reads the SAME already-packed-and-extracted directory `global-setup.ts`
// produces exactly once for the whole suite — this file used to run its own
// `npm pack` in a `beforeAll`, which raced with `entries.test.ts` doing the
// identical thing concurrently (see `global-setup.ts`'s doc comment for the
// empirical proof that `--ignore-scripts` does not actually suppress `npm
// pack`'s `prepare` script here).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACK_EXTRACT_DIR } from './global-setup';
import { resolveExportsTarget, walkTransitiveSpecifiers } from './helpers/resolve';

const repoRoot = path.resolve(__dirname, '../..');
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  exports: Record<string, unknown>;
};

const packageDir = PACK_EXTRACT_DIR;

function tarballPath(...segments: string[]): string {
  return path.join(packageDir, ...segments);
}

describe('theming interop subpath exports (tasks.md 7.4)', () => {
  describe.each([
    { subpath: './uniwind', mustContain: 'withUniwind' },
    { subpath: './nativewind', mustContain: 'cssInterop' },
  ])('$subpath resolves independently of the default entry', ({ subpath, mustContain }) => {
    it(`exports['${subpath}'].default points at a real JS file in the tarball, exercising the real underlying API`, () => {
      const conditions = (packageJson.exports as Record<string, unknown>)[subpath];
      expect(conditions, `package.json exports is missing the "${subpath}" subpath entirely`).toBeDefined();

      const jsTarget = resolveExportsTarget(conditions, []); // 'default' always matches
      expect(jsTarget, `exports['${subpath}'] has no resolvable JS target`).not.toBeNull();
      const jsAbs = tarballPath(jsTarget!.replace(/^\.\//, ''));
      expect(existsSync(jsAbs), `${jsTarget} does not exist in the packed tarball`).toBe(true);
      expect(
        readFileSync(jsAbs, 'utf8'),
        `${jsTarget} does not reference "${mustContain}" — the compiled output does not look like the real interop`,
      ).toContain(mustContain);

      const typesTarget = resolveExportsTarget(conditions, ['types']);
      expect(typesTarget, `exports['${subpath}'] has no resolvable "types" target`).not.toBeNull();
      const typesAbs = tarballPath(typesTarget!.replace(/^\.\//, ''));
      expect(existsSync(typesAbs), `${typesTarget} does not exist in the packed tarball`).toBe(true);
    });
  });

  describe('default entries have ZERO transitive dependency on either interop module', () => {
    const defaultEntries = ['lib/module/index.native.js', 'lib/module/index.web.js', 'lib/module/index.js'];

    it.each(defaultEntries)('%s never transitively resolves into src/interop/', (relativeEntry) => {
      const entry = tarballPath(relativeEntry);
      expect(existsSync(entry), `${relativeEntry} does not exist in the packed tarball`).toBe(true);

      const { allSpecifiers, visitedFiles } = walkTransitiveSpecifiers(entry);
      // Sanity: the walk visited a real, non-trivial graph — guards this
      // assertion against silently degrading to a same-file-only check that
      // would pass vacuously regardless of what the interop modules do.
      expect(visitedFiles).toBeGreaterThan(1);

      const interopSpecifiers = Array.from(allSpecifiers).filter((s) => s.includes('interop'));
      expect(
        interopSpecifiers,
        `${relativeEntry}'s transitive import graph references the theming interop directory: ${interopSpecifiers.join(', ')}`,
      ).toEqual([]);
    });
  });

  describe('interop.js.js.js not a symptom: sanity that entries actually resolved a non-empty graph', () => {
    it('lib/module/index.native.js visits more than one file (guards the "zero transitive dependency" check above against vacuous pass)', () => {
      const { visitedFiles } = walkTransitiveSpecifiers(tarballPath('lib/module/index.native.js'));
      expect(visitedFiles).toBeGreaterThan(5);
    });
  });
});
