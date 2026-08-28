import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

/**
 * G.4 gap closure (tasks.md) — a minimal simulation of Node's
 * PACKAGE_IMPORTS_EXPORTS_RESOLVE algorithm (which TypeScript's
 * exports-aware resolution mirrors), restricted to what this package's
 * `exports['.']` shape actually needs: nested condition objects with a
 * `types` sub-condition, and a `default` fallback at every level.
 *
 * Node/TypeScript check an object's OWN keys in the order they appear in the
 * JSON, and take the FIRST key that is either `"default"` or an active
 * condition — this is exactly why the pre-fix flat `exports['.'].types`
 * field broke platform-specific types: `"types"` was listed before
 * `"react-native"`/`"browser"`, so it matched and won regardless of which
 * platform condition was active.
 *
 * This is a structural simulation for a fast, deterministic unit test. The
 * real consumer proof (actually running `tsc` against the packed tarball
 * from `examples/bare-rn` and `examples/vite`) is documented in the apply
 * report and the repository README, not reproduced here.
 */
function resolveExportsTarget(target: unknown, activeConditions: string[]): string | null {
  if (typeof target === 'string') return target;
  if (target && typeof target === 'object') {
    for (const [key, value] of Object.entries(target as Record<string, unknown>)) {
      if (key === 'default' || activeConditions.includes(key)) {
        const resolved = resolveExportsTarget(value, activeConditions);
        if (resolved !== null) return resolved;
      }
    }
  }
  return null;
}

let extractDir: string;
let packageDir: string;

beforeAll(() => {
  // `lib/` is already fresh — Vitest's `globalSetup`
  // (`test/packaging/global-setup.ts`) runs `bob build` exactly once, before
  // any test file starts. `--ignore-scripts` stops `npm pack` from re-running
  // the `prepare` lifecycle script (which would otherwise rebuild `lib/` a
  // second, redundant time here); this exercises the real publishable
  // artifact packed from what global setup already built, not the source
  // tree directly. `bob build`'s progress logs used to corrupt `npm pack
  // --json`'s stdout when both ran together — with `--ignore-scripts` there
  // are no such logs at all, but this still avoids parsing JSON and just
  // looks at what landed in the dedicated pack-destination directory (only
  // ever one tarball).
  const tmpPackDir = mkdtempSync(path.join(tmpdir(), 'autoskeleton-pack-'));
  execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', tmpPackDir], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const [filename] = readdirSync(tmpPackDir).filter((f) => f.endsWith('.tgz'));
  if (!filename) {
    throw new Error(`npm pack did not produce a .tgz file in ${tmpPackDir}`);
  }
  const tgzFile = path.join(tmpPackDir, filename);

  extractDir = mkdtempSync(path.join(tmpdir(), 'autoskeleton-extract-'));
  execFileSync('tar', ['-xzf', tgzFile, '-C', extractDir]);
  packageDir = path.join(extractDir, 'package');
}, 120_000);

afterAll(() => {
  if (extractDir) rmSync(extractDir, { recursive: true, force: true });
});

function tarballPath(...segments: string[]): string {
  return path.join(packageDir, ...segments);
}

/** Recursively lists every file (not directory) under `dir`, as paths relative to `dir`. */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(abs).map((f) => path.join(entry.name, f)));
    } else {
      out.push(entry.name);
    }
  }
  return out;
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

    function collectSpecifiers(filePath: string): string[] {
      const source = readFileSync(filePath, 'utf8');
      const specifiers: string[] = [];
      const importRe = /(?:require\(|from\s+)['"]([^'"]+)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = importRe.exec(source))) {
        specifiers.push(match[1]!);
      }
      return specifiers;
    }

    /** Resolves a relative specifier to a real file within `dir`, trying
     *  every shape builder-bob's per-file transpile output uses: the
     *  specifier as-is (it already includes `.js`, e.g. `./web/AutoSkeleton.
     *  js`), `<path>.js`, and `<path>/index.js`. Returns `undefined` for a
     *  bare (non-relative) specifier — those are exactly what the
     *  banned-specifier check below inspects directly, without trying to
     *  resolve them on disk. */
    function resolveRelative(fromFile: string, specifier: string): string | undefined {
      if (!specifier.startsWith('.')) {
        return undefined;
      }
      const base = path.resolve(path.dirname(fromFile), specifier);
      const candidates = [base, `${base}.js`, path.join(base, 'index.js')];
      return candidates.find((c) => existsSync(c));
    }

    function walkTransitiveSpecifiers(entryFile: string): { allSpecifiers: Set<string>; visitedFiles: number } {
      const visited = new Set<string>();
      const allSpecifiers = new Set<string>();
      const queue = [entryFile];
      while (queue.length > 0) {
        const file = queue.shift()!;
        if (visited.has(file)) continue;
        visited.add(file);
        for (const specifier of collectSpecifiers(file)) {
          allSpecifiers.add(specifier);
          const resolved = resolveRelative(file, specifier);
          if (resolved && !visited.has(resolved)) {
            queue.push(resolved);
          }
        }
      }
      return { allSpecifiers, visitedFiles: visited.size };
    }

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
