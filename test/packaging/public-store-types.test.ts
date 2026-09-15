import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACK_EXTRACT_DIR } from './global-setup';
import { resolveExportsTarget } from './helpers/resolve';

// A public prop must be typed against a public type.
//
// `SkeletonProviderProps.store?: MemoryShapeStore` is declared on BOTH
// platforms (`src/native/AutoSkeleton.tsx`, `src/web/AutoSkeleton.tsx`), and
// `AutoSkeletonSSRHydrate`'s `store` prop is typed against `ShapeStore`.
// Neither type was exported from any entry point, so a consumer could read the
// prop in the docs, see its type, and have no way to construct a value for it.
// The scoped-store feature was unreachable from outside the package — which is
// also why no example app demonstrates it.
//
// These assertions read the PACKED declarations, not `src/`, because what a
// consumer can name is decided by what ships.

const repoRoot = path.resolve(__dirname, '../..');
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  exports: Record<string, unknown>;
};

/** Reads a declaration file, transparently following a pure re-export barrel.
 *
 *  `src/index.ts` is exactly that: a single `export * from './index.web'` whose
 *  only job (per ADR-3 rule 4) is to give a filename-preserving build an
 *  `index.js` to emit. Asserting on its literal text would prove nothing about
 *  what a consumer resolving the `default` condition can actually name, so the
 *  barrel is followed to the file that holds the real declarations. */
function readDeclarations(abs: string, depth = 0): string {
  const source = readFileSync(abs, 'utf8');
  const barrel = source.match(/^\s*export\s+\*\s+from\s+'([^']+)';\s*$/m);
  const hasOwnDeclarations = /^\s*(export\s+(declare|type|\{)|declare)/m.test(source);
  if (barrel && !hasOwnDeclarations && depth < 4) {
    const next = path.resolve(path.dirname(abs), barrel[1]!.replace(/\.js$/, '.d.ts'));
    if (existsSync(next)) {
      return readDeclarations(next, depth + 1);
    }
  }
  return source;
}

function declarationsFor(subpath: string, conditions: string[]): string {
  const target = resolveExportsTarget(packageJson.exports[subpath], [...conditions, 'types']);
  expect(target, `no types target for '${subpath}' under [${conditions.join(', ')}]`).not.toBeNull();
  const abs = path.join(PACK_EXTRACT_DIR, target!.replace(/^\.\//, ''));
  expect(existsSync(abs), `${target} is not in the packed tarball`).toBe(true);
  return readDeclarations(abs);
}

describe('the store types behind public props are themselves public', () => {
  it.each([
    ['.', ['react-native']],
    ['.', ['browser']],
    ['.', []],
  ] as const)("exports['%s'] under [%s] declares MemoryShapeStore", (subpath, conditions) => {
    expect(
      declarationsFor(subpath, [...conditions]),
      'SkeletonProvider accepts a `store` prop typed against MemoryShapeStore, but a consumer cannot name or construct one'
    ).toContain('MemoryShapeStore');
  });

  it.each([
    ['.', ['react-native']],
    ['.', ['browser']],
    ['.', []],
  ] as const)("exports['%s'] under [%s] declares ShapeStore", (subpath, conditions) => {
    expect(declarationsFor(subpath, [...conditions])).toContain('ShapeStore');
  });

  it('the ssr entry declares ShapeStore, which types AutoSkeletonSSRHydrate\'s store prop', () => {
    expect(declarationsFor('./ssr', [])).toContain('ShapeStore');
  });
});
