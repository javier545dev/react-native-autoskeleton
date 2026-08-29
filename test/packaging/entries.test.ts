import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACK_EXTRACT_DIR } from './global-setup';
import {
  collectTypesTargets,
  resolveExportsTarget,
  walkFiles,
  walkTransitiveSpecifiers,
} from './helpers/resolve';

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

  describe('EVERY exports condition ships real declarations, never raw TypeScript', () => {
    // Adversarial review, batch 3. `exports['./cli'].default.types` pointed at
    // `./cli/index.ts` — RAW TypeScript SOURCE, not a built `.d.ts`. A consumer
    // following `docs/ssr-capture-cli.md`'s documented Programmatic API therefore
    // had OUR entire `cli/` + `src/core/` + `src/web/` source tree pulled into
    // THEIR `tsc` program and compiled under THEIR compiler options, producing a
    // wall of errors in files they never wrote.
    //
    // `skipLibCheck` does NOT rescue this, and that is the whole reason this
    // guard is worth its weight: `skipLibCheck` skips type checking of
    // DECLARATION (`.d.ts`) files only. A `.ts` file is not one, so it is fully
    // checked no matter what the consumer sets.
    //
    // The existing per-condition assertions above only covered `exports['.']`,
    // which is exactly how a hand-authored subpath slipped through. This walks
    // the WHOLE `exports` tree instead, so any future subpath is covered the day
    // it is added rather than the day someone remembers to extend a test.
    const typesTargets = collectTypesTargets(packageJson.exports);

    it('finds a types condition under every subpath that declares one (guards the walker itself)', () => {
      expect(typesTargets.length).toBeGreaterThanOrEqual(6);
      expect(typesTargets.map((t) => t.path)).toEqual(
        expect.arrayContaining([
          expect.stringContaining('./cli'),
          expect.stringContaining('./uniwind'),
          expect.stringContaining('./ssr'),
        ]),
      );
    });

    it.each(typesTargets.map((t) => [t.path, t.target] as const))(
      'exports[%s] points at a built .d.ts, not raw TypeScript source',
      (conditionPath, target) => {
        expect(
          target.endsWith('.d.ts'),
          `exports[${conditionPath}] is "${target}". A consumer's tsc COMPILES a non-.d.ts ` +
            `target under their own options — skipLibCheck skips .d.ts files only, so it cannot ` +
            `rescue this. Point it at a built declaration file instead.`,
        ).toBe(true);
      },
    );

    it.each(typesTargets.map((t) => [t.path, t.target] as const))(
      'exports[%s] resolves to a file that actually exists in the packed tarball',
      (conditionPath, target) => {
        const resolved = tarballPath(target.replace(/^\.\//, ''));
        expect(
          existsSync(resolved),
          `exports[${conditionPath}] resolves to ${target}, which is not in the packed tarball`,
        ).toBe(true);
      },
    );

    it('ships no raw .ts source under the published cli/ directory either (the source that used to be the types target)', () => {
      // The `types` field is the pointer; `files` is what actually ships. Both
      // had to be wrong together for the defect to reach a consumer, so both
      // are asserted — a `.d.ts` pointer with the raw sources still shipped
      // alongside is a foot-gun waiting for the next hand-authored subpath.
      const shipped = walkFiles(packageDir).filter(
        (f) => f.startsWith(`cli${path.sep}`) && f.endsWith('.ts') && !f.endsWith('.d.ts'),
      );
      expect(
        shipped,
        `these raw TypeScript sources ship under cli/ in the tarball: ${shipped.join(', ')}`,
      ).toEqual([]);
    });
  });

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

  describe('no non-optional peer outside the allowlist (RISK-5, orchestrator-found defect)', () => {
    // Sibling of the runtime-`dependencies` guard below, one level up.
    // npm 7+ AUTO-INSTALLS any peerDependency not marked optional, so a
    // required peer is a forced download, not merely a declared expectation.
    //
    // `react-native` was REQUIRED, which meant a web-only consumer (Vite,
    // Next.js) downloaded React Native, the Hermes compiler, react-devtools
    // and Babel to render skeletons in a browser. Measured: 226 packages /
    // 166 MB, against 1 package / 3.3 MB for the package alone.
    //
    // Only `react` genuinely belongs here: it is the one dependency every
    // consumer of this library has on every platform. Everything else —
    // react-native, Skia, Reanimated, uniwind, the capture CLI's playwright —
    // is platform- or feature-specific and must be `optional`, so npm leaves
    // the choice to the consumer. The web entry's import graph is already
    // asserted above to contain no native specifier, so a web consumer
    // genuinely never needs react-native present.
    const ALLOWED_REQUIRED_PEERS = ['react'];

    it('every peerDependency outside the allowlist is marked optional', () => {
      const peers = Object.keys(packageJson.peerDependencies ?? {});
      const meta = (packageJson as { peerDependenciesMeta?: Record<string, { optional?: boolean }> })
        .peerDependenciesMeta ?? {};
      const requiredPeers = peers.filter(
        (name) => meta[name]?.optional !== true && !ALLOWED_REQUIRED_PEERS.includes(name),
      );
      expect(
        requiredPeers,
        `these peers are not marked optional, so npm 7+ force-installs them for every consumer ` +
          `regardless of platform: ${requiredPeers.join(', ')}`,
      ).toEqual([]);
    });
  });

  describe('no runtime `dependencies` footprint (RISK-5, orchestrator-found defect)', () => {
    // Root cause: `@playwright/test` and `esbuild` — real runtime needs of
    // ONLY the capture CLI (`cli/`), never of the library's own web/native
    // runtime surface — sat in `package.json`'s top-level `dependencies`.
    // `dependencies` is installed for EVERY consumer unconditionally, so a
    // consumer who never touches the CLI was forced to download a full
    // Chromium-driving test framework and a bundler: measured in a clean
    // `npm init` sandbox installing only the packed tarball, 231 packages /
    // 194 MB, for a library whose web entry is ~8 KB gzip. This directly
    // contradicts NFR-6's own "no runtime dependencies beyond React on web"
    // framing. `@playwright/test` is an irreducible runtime need of the CLI
    // (it drives a real browser) and moved to an optional `peerDependency`
    // instead — a CLI user installs it deliberately, everyone else installs
    // nothing extra. `esbuild` was only ever used to bundle the injected
    // browser runtime (`cli/browser-runtime.ts`) AT CAPTURE TIME — that
    // bundle is static (never parameterized per capture, see
    // `cli/browser-runtime.ts`), so it is now pre-built once at
    // `npm run build:cli` time and shipped as `dist-cli/browser-runtime.bundle.js`;
    // `esbuild` moved to a plain `devDependency` (build-time only, never
    // required by a published consumer at all — not even as a peer).
    //
    // `ALLOWED_RUNTIME_DEPENDENCIES` is a deliberate, reviewed allowlist,
    // not a blanket ban — a genuine future runtime need of the LIBRARY
    // itself (not the CLI) would be added here explicitly, never silently.
    const ALLOWED_RUNTIME_DEPENDENCIES: readonly string[] = [];

    it('the published package.json declares no unreviewed runtime `dependencies`', () => {
      const deps = Object.keys(packageJson.dependencies ?? {});
      const unreviewed = deps.filter((d) => !ALLOWED_RUNTIME_DEPENDENCIES.includes(d));
      expect(
        unreviewed,
        `package.json "dependencies" contains unreviewed runtime dependencies that every ` +
          `consumer installs unconditionally: ${unreviewed.join(', ') || '(none)'}. Move each ` +
          `to peerDependencies (if it is a genuine runtime need of a consumer-facing surface, ` +
          `made optional when only some consumers need it) or devDependencies (if it is only a ` +
          `build/test-time need of this repo), or add it to ALLOWED_RUNTIME_DEPENDENCIES above ` +
          `with a reviewed justification.`
      ).toEqual([]);
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
