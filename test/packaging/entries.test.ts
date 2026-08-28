import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACK_EXTRACT_DIR } from './global-setup';
import { resolveExportsTarget, walkFiles, walkTransitiveSpecifiers } from './helpers/resolve';

// Task 0.6 (tasks.md Phase 0) — the RISK-5 packaging detector, written FIRST per
// plan.md's ordering (plan.md §9 RISK-5, ADR-3, ADR-14).
//
// THIS TEST IS DELIBERATELY RED AND MUST STAY RED UNTIL TASK 5.6 CLOSES IT.
// `src/index.web.ts` (task 2.3) and `src/index.native.ts` (task 5.5) do not exist
// yet — Phase 0 only scaffolds the tree they will be written into (ADR-3's
// three-entry-file requirement cannot be satisfied before those source files
// exist). A packaging test that passed today would either be testing nothing or
// silently accepting the exact `index.native.ts`-resolves-on-web defect ADR-3
// exists to prevent (brief §2: Metro's `preferNativePlatform: true` is
// unconditional). See the Phase 0 apply report for the exact failing assertions
// and why each one fails for the right reason.
//
// Run in isolation: `vitest run test/packaging/entries.test.ts`.

const repoRoot = path.resolve(__dirname, '../..');
const packageJson = JSON.parse(
  readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
) as {
  exports: Record<string, unknown>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

// `resolveExportsTarget` (G.4 gap closure's exports-resolution simulator)
// and `walkFiles`/`walkTransitiveSpecifiers` (below) now live in
// `./helpers/resolve.ts`, shared with `test/packaging/interop-exports.test.ts`
// (tasks.md 7.4) — see that module's doc comment for the full algorithm
// rationale. This is a pure extraction; behavior is unchanged.
//
// tasks.md 7.4 CORRECTION: this file used to run its own `npm pack` in a
// `beforeAll` here. That call raced with `interop-exports.test.ts` doing the
// exact same thing concurrently (`--ignore-scripts` does NOT actually
// suppress `npm pack`'s `prepare` script — see `global-setup.ts`'s corrected
// doc comment for the empirical proof). The pack+extract step now runs
// exactly ONCE, in `global-setup.ts`, and every packaging test file that
// needs the published artifact reads that same already-extracted directory.

const packageDir = PACK_EXTRACT_DIR;

function tarballPath(...segments: string[]): string {
  return path.join(packageDir, ...segments);
}

describe('RISK-5 packaging detector (entries.test.ts) — RED until 5.6', () => {
  describe('entry files (ADR-3): index.web.js / index.native.js / index.js', () => {
    it.each(['lib/module', 'lib/commonjs'])(
      '%s/index.web.js exists in the packed tarball',
      (dir) => {
        expect(existsSync(tarballPath(dir, 'index.web.js'))).toBe(true);
      }
    );

    it.each(['lib/module', 'lib/commonjs'])(
      '%s/index.native.js exists in the packed tarball',
      (dir) => {
        expect(existsSync(tarballPath(dir, 'index.native.js'))).toBe(true);
      }
    );

    it.each(['lib/module', 'lib/commonjs'])(
      '%s/index.js exists in the packed tarball (default/Metro-step-3 target)',
      (dir) => {
        expect(existsSync(tarballPath(dir, 'index.js'))).toBe(true);
      }
    );
  });

  describe('exports conditions (ADR-3) resolve to an existing file', () => {
    // `exports['.']` conditions are nested objects (G.4 gap closure: each
    // carries its own `types` sub-condition alongside `default`, the JS
    // runtime target) — resolve the JS-runtime target the same way Node's
    // module resolver does, not with a flat string lookup.
    const conditions = packageJson.exports['.'];

    it.each(['react-native', 'browser', 'default'] as const)(
      "exports['.'].%s points at a file that exists in the tarball",
      (condition) => {
        const target = resolveExportsTarget(conditions, [condition]);
        expect(
          target,
          `package.json exports['.'] is missing the "${condition}" condition`
        ).not.toBeNull();
        const resolved = tarballPath(target!.replace(/^\.\//, ''));
        expect(
          existsSync(resolved),
          `exports['.']['${condition}'] resolves to ${target}, which does not exist in the packed tarball`
        ).toBe(true);
      }
    );
  });

  describe(
    "exports['.'] conditions carry per-platform TypeScript declarations " +
      '(G.4 gap closure: Phase 6 native-only API was invisible to TypeScript)',
    () => {
      const conditions = packageJson.exports['.'];

      it('exports[\'.\'] does not set a single top-level "types" field (react-native-builder-bob\'s typescript-target validator only inspects it when truthy — see typescript.js:244)', () => {
        expect(Object.prototype.hasOwnProperty.call(conditions as object, 'types')).toBe(false);
      });

      it('resolving [react-native, types] reaches a declaration file that actually declares SkeletonList', () => {
        const resolved = resolveExportsTarget(conditions, ['react-native', 'types']);
        expect(resolved, 'no exports[\'.\'] entry matched conditions [react-native, types]').not.toBeNull();
        const abs = tarballPath(resolved!.replace(/^\.\//, ''));
        expect(existsSync(abs), `${resolved} does not exist in the packed tarball`).toBe(true);
        expect(
          readFileSync(abs, 'utf8'),
          `${resolved} does not declare SkeletonList — the native-only Phase 6 API is invisible to a react-native TypeScript consumer`
        ).toContain('SkeletonList');
      });

      it('resolving [browser, types] reaches a declaration file that does NOT declare SkeletonList (native-only API must stay invisible on web)', () => {
        const resolved = resolveExportsTarget(conditions, ['browser', 'types']);
        expect(resolved).not.toBeNull();
        const abs = tarballPath(resolved!.replace(/^\.\//, ''));
        expect(existsSync(abs)).toBe(true);
        expect(readFileSync(abs, 'utf8')).not.toContain('SkeletonList');
      });

      it('resolving [types] with no platform condition active (bundler/Node default — vite/next without customConditions) also does not declare SkeletonList', () => {
        const resolved = resolveExportsTarget(conditions, ['types']);
        expect(resolved).not.toBeNull();
        const abs = tarballPath(resolved!.replace(/^\.\//, ''));
        expect(existsSync(abs)).toBe(true);
        expect(readFileSync(abs, 'utf8')).not.toContain('SkeletonList');
      });

      it('react-native and browser resolve to genuinely different declaration files', () => {
        const native = resolveExportsTarget(conditions, ['react-native', 'types']);
        const web = resolveExportsTarget(conditions, ['browser', 'types']);
        expect(native).not.toBeNull();
        expect(web).not.toBeNull();
        expect(native).not.toEqual(web);
      });

      it('JS runtime resolution is unaffected by nesting types under each condition: react-native/browser/default still resolve to existing JS files', () => {
        for (const condition of ['react-native', 'browser', 'default'] as const) {
          const resolved = resolveExportsTarget(conditions, [condition]);
          expect(resolved, `no JS resolution for condition "${condition}"`).not.toBeNull();
          expect(
            existsSync(tarballPath(resolved!.replace(/^\.\//, ''))),
            `${resolved} (condition "${condition}") does not exist in the packed tarball`
          ).toBe(true);
        }
      });
    }
  );

  describe('Metro resolution simulation for platform:"web" (brief §2)', () => {
    /**
     * Mirrors metro-resolver's resolveSourceFileForAllExts order (brief §2,
     * verified from metro-resolver/src/resolve.js:587-601):
     *   (1) `.${platform}${ext}`
     *   (2) `.native${ext}` — only because preferNativePlatform is unconditionally
     *       true (DependencyGraph.js:153), on EVERY platform including web
     *   (3) bare `${ext}`
     * This is the exact trap ADR-3 exists to close: on web, step (1) must win
     * before step (2) can ever fire.
     */
    function simulateMetroResolution(dir: string, base: string, platform: string): string | null {
      const candidates = [`${base}.${platform}.js`, `${base}.native.js`, `${base}.js`];
      for (const candidate of candidates) {
        if (existsSync(path.join(dir, candidate))) return candidate;
      }
      return null;
    }

    it.each(['lib/module', 'lib/commonjs'])(
      'platform:"web" resolution against %s selects index.web.js, not index.native.js',
      (dir) => {
        const resolved = simulateMetroResolution(tarballPath(dir), 'index', 'web');
        expect(
          resolved,
          `Metro's platform:"web" resolution against ${dir}/ found no candidate at all — ` +
            'index.web.js does not exist yet (created in task 2.3)'
        ).toBe('index.web.js');
      }
    );
  });

  describe('web-facing transitive import graph excludes native/Skia/Reanimated specifiers', () => {
    // Task 2.5 (tasks.md Phase 2): "extend 0.6's packaging test to assert
    // index.web.js's transitive graph excludes native/Skia/Reanimated
    // specifiers". A single entry file's OWN specifiers are not its
    // transitive graph — `index.web.js` re-exports from `./web/AutoSkeleton`,
    // which itself imports `../core/*` and further `./web/*` files. This
    // walks every relative import reachable from the entry, across the whole
    // resolved file set, which is what "transitive" actually requires.
    const bannedSpecifiers = ['react-native', '@shopify/react-native-skia', 'react-native-reanimated'];

    it('lib/module/index.web.js exists so its import graph can be inspected', () => {
      const entry = tarballPath('lib/module/index.web.js');
      expect(
        existsSync(entry),
        'lib/module/index.web.js does not exist yet (created in task 2.3) — ' +
          'the transitive-import-graph check has nothing to inspect, which is ' +
          'itself the RISK-5 gap this test documents'
      ).toBe(true);
      if (!existsSync(entry)) return;

      const { allSpecifiers, visitedFiles } = walkTransitiveSpecifiers(entry);
      // A real transitive walk over a non-trivial component graph (sensor +
      // renderer + component + several core modules) MUST visit more than
      // just the single entry file — this guards against the walk silently
      // degrading back into a same-file-only check.
      expect(visitedFiles).toBeGreaterThan(1);
      for (const banned of bannedSpecifiers) {
        expect(Array.from(allSpecifiers)).not.toContain(banned);
      }
    });

    it('lib/commonjs/index.web.js transitive graph also excludes them', () => {
      const entry = tarballPath('lib/commonjs/index.web.js');
      expect(existsSync(entry), 'lib/commonjs/index.web.js does not exist yet (created in task 2.3)').toBe(true);
      if (!existsSync(entry)) return;

      const { allSpecifiers, visitedFiles } = walkTransitiveSpecifiers(entry);
      expect(visitedFiles).toBeGreaterThan(1);
      for (const banned of bannedSpecifiers) {
        expect(Array.from(allSpecifiers)).not.toContain(banned);
      }
    });
  });

  describe('tarball completeness (ADR-14)', () => {
    it('contains the root *.podspec', () => {
      expect(existsSync(tarballPath('Autoskeleton.podspec'))).toBe(true);
    });

    it('contains android/', () => {
      expect(existsSync(tarballPath('android', 'build.gradle'))).toBe(true);
    });

    it('contains react-native.config.js', () => {
      expect(existsSync(tarballPath('react-native.config.js'))).toBe(true);
    });
  });

  describe('no expo-* dependency (ADR-14)', () => {
    it('dependencies contains no expo-* entry', () => {
      const deps = Object.keys(packageJson.dependencies ?? {});
      expect(deps.filter((d) => d.startsWith('expo'))).toEqual([]);
    });

    it('peerDependencies contains no expo-* entry', () => {
      const peerDeps = Object.keys(packageJson.peerDependencies ?? {});
      expect(peerDeps.filter((d) => d.startsWith('expo'))).toEqual([]);
    });
  });

  describe('no test artifacts in the published tarball (packaging defect, orchestrator-found)', () => {
    // Root cause: package.json's `files` key excludes `**/__tests__`, but
    // Phase 1 co-located tests as `src/core/*.test.ts` (never in a
    // `__tests__/` directory), so builder-bob's per-file transpile compiles
    // them into `lib/**` and `npm pack` ships them — 52 artifacts as of this
    // writing, e.g. `lib/module/core/cache-key.test.js`. Those compiled
    // files `import 'vitest'`, a devDependency the published package never
    // declares, so a consumer bundler that resolves one fails on a missing
    // dependency. Co-location itself is fine; only the packaging is broken.
    it('the packed tarball contains zero .test.js / .test.d.ts artifacts', () => {
      const files = walkFiles(packageDir);
      const testArtifacts = files.filter((f) => f.endsWith('.test.js') || f.endsWith('.test.d.ts'));
      expect(testArtifacts).toEqual([]);
    });
  });
});
