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

let extractDir: string;
let packageDir: string;

beforeAll(() => {
  // `npm pack` runs the `prepare` lifecycle script (bob build) itself, so this
  // exercises the real publishable artifact, not the source tree. `bob build`
  // writes its own progress logs to stdout, which corrupts `npm pack --json`'s
  // stdout — so instead of parsing JSON, just look at what landed in the
  // dedicated pack-destination directory (only ever one tarball).
  const tmpPackDir = mkdtempSync(path.join(tmpdir(), 'autoskeleton-pack-'));
  execFileSync('npm', ['pack', '--pack-destination', tmpPackDir], {
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
    const conditions = packageJson.exports['.'] as Record<string, string>;

    it.each(['react-native', 'browser', 'default'] as const)(
      "exports['.'].%s points at a file that exists in the tarball",
      (condition) => {
        const target = conditions[condition];
        expect(
          target,
          `package.json exports['.'] is missing the "${condition}" condition`
        ).toBeDefined();
        const resolved = tarballPath(target!.replace(/^\.\//, ''));
        expect(
          existsSync(resolved),
          `exports['.']['${condition}'] resolves to ${target}, which does not exist in the packed tarball`
        ).toBe(true);
      }
    );
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
    const bannedSpecifiers = [
      'react-native',
      '@shopify/react-native-skia',
      'react-native-reanimated',
    ];

    function collectRequireSpecifiers(filePath: string): string[] {
      const source = readFileSync(filePath, 'utf8');
      const specifiers: string[] = [];
      const importRe = /(?:require\(|from\s+)['"]([^'"]+)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = importRe.exec(source))) {
        specifiers.push(match[1]!);
      }
      return specifiers;
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

      const specifiers = collectRequireSpecifiers(entry);
      for (const banned of bannedSpecifiers) {
        expect(specifiers).not.toContain(banned);
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
});
