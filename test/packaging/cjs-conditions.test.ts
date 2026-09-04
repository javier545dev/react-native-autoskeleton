import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACK_EXTRACT_DIR } from './global-setup';
import { resolveExportsTarget } from './helpers/resolve';

// The CommonJS-reachability detector.
//
// `react-native-builder-bob` emits a complete `lib/commonjs/` tree (174 files)
// and a matching `lib/typescript/commonjs/` declaration tree on every
// `prepare`. Until this file existed, NO path in `package.json#exports`
// pointed at either of them, so both were unreachable through the only
// resolution mechanism Node consults once `exports` is present.
//
// WHY `main` DOES NOT COVER THIS. `package.json#main` and `#react-native` do
// name `lib/commonjs/*`, and bundlers that ignore `exports` (the case commit
// 777aaba added the `react-native` field for) still reach them. Node is the
// platform that breaks: per the resolution spec, once a package declares
// `exports`, `main` is never consulted. So `require('autoskeleton')` resolved
// through `exports['.'].default` to `lib/module/index.js`, which sits under a
// `{"type":"module"}` marker — an ESM file handed to a CJS caller.
//
// WHY THAT IS A REAL BREAK AND NOT A THEORETICAL ONE. `engines.node` declares
// `>= 22.11.0`. Unflagged `require(esm)` landed in Node 22.12, one patch
// later. A consumer sitting exactly on the declared floor gets
// `ERR_REQUIRE_ESM`, as does Jest under its default CJS transform and any
// `require('autoskeleton')` inside a `next.config.js`. The defect is invisible
// on a modern local Node, which is why it survived this long.
//
// These assertions pin the resolution, not the file listing — `entries.test.ts`
// already proves the files exist. What matters here is that a `require`
// consumer REACHES them.

const repoRoot = path.resolve(__dirname, '../..');
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  exports: Record<string, unknown>;
  engines?: Record<string, string>;
};

const packageDir = PACK_EXTRACT_DIR;

function tarballPath(target: string): string {
  return path.join(packageDir, target.replace(/^\.\//, ''));
}

/** Node decides a file's module format from the nearest enclosing
 *  `package.json#type`, not from its contents. This walks the same way. */
function nearestPackageType(absFile: string): 'module' | 'commonjs' {
  let dir = path.dirname(absFile);
  while (dir.startsWith(packageDir)) {
    const pkg = path.join(dir, 'package.json');
    if (existsSync(pkg)) {
      const parsed = JSON.parse(readFileSync(pkg, 'utf8')) as { type?: string };
      if (parsed.type === 'module') return 'module';
      if (parsed.type === 'commonjs') return 'commonjs';
    }
    dir = path.dirname(dir);
  }
  return 'commonjs';
}

/** Every subpath a consumer can `require`, with the condition set Node would
 *  activate for a plain CommonJS caller on the server (no bundler, so neither
 *  `browser` nor `react-native` is asserted). */
const REQUIRE_SUBPATHS = ['.', './skia', './ssr', './uniwind'] as const;

describe('CommonJS consumers can reach the CommonJS build', () => {
  it.each(REQUIRE_SUBPATHS)(
    "exports['%s'] resolves to a CommonJS file for a `require` caller",
    (subpath) => {
      const conditions = packageJson.exports[subpath];
      const target = resolveExportsTarget(conditions, ['require', 'node']);

      expect(target, `package.json exports['${subpath}'] has no reachable target for a require caller`).not.toBeNull();

      const abs = tarballPath(target!);
      expect(existsSync(abs), `exports['${subpath}'] resolves to ${target}, which is not in the packed tarball`).toBe(
        true
      );

      expect(
        nearestPackageType(abs),
        `exports['${subpath}'] hands a require() caller ${target}, which Node treats as ESM. ` +
          'On the Node version this package declares as its floor that throws ERR_REQUIRE_ESM.'
      ).toBe('commonjs');
    }
  );

  it.each(REQUIRE_SUBPATHS)(
    "exports['%s'] gives a `require` caller CommonJS-flavoured type declarations",
    (subpath) => {
      const conditions = packageJson.exports[subpath];
      const target = resolveExportsTarget(conditions, ['require', 'node', 'types']);

      expect(target, `no types target for a require caller of '${subpath}'`).not.toBeNull();
      const abs = tarballPath(target!);
      expect(existsSync(abs), `${target} is not in the packed tarball`).toBe(true);
      expect(
        nearestPackageType(abs),
        `'${subpath}' describes its CommonJS runtime with declarations that live under a "type":"module" marker`
      ).toBe('commonjs');
    }
  );

  it('./cli describes its CommonJS binary with CommonJS declarations', () => {
    // `scripts/build-cli.mjs` bundles `dist-cli/*` as `format: 'cjs'`, so the
    // ESM declaration tree is the wrong shape to describe it regardless of
    // which condition a caller activates.
    const target = resolveExportsTarget(packageJson.exports['./cli'], ['types']);
    expect(target).not.toBeNull();
    expect(
      nearestPackageType(tarballPath(target!)),
      './cli runtime is CommonJS but its declarations sit under a "type":"module" marker'
    ).toBe('commonjs');
  });

  it('an `import` caller still reaches the ESM build (the require condition must not shadow it)', () => {
    for (const subpath of REQUIRE_SUBPATHS) {
      const target = resolveExportsTarget(packageJson.exports[subpath], ['import', 'node']);
      expect(target, `exports['${subpath}'] has no target for an import caller`).not.toBeNull();
      expect(
        nearestPackageType(tarballPath(target!)),
        `exports['${subpath}'] regressed: an import caller now gets CommonJS`
      ).toBe('module');
    }
  });

  it('the browser and react-native conditions still win over require/import ordering', () => {
    // Condition order in the JSON is significant: Node takes the FIRST
    // matching key. A bundler asserts `browser` AND `require` at once, and
    // must still get the web entry rather than the platform-neutral one.
    const browserRequire = resolveExportsTarget(packageJson.exports['.'], ['browser', 'require']);
    expect(browserRequire).toContain('index.web');

    const rnRequire = resolveExportsTarget(packageJson.exports['.'], ['react-native', 'require']);
    expect(rnRequire).toContain('index.native');
  });
});
