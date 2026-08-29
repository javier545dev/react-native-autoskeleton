// test/packaging/helpers/resolve.ts
//
// tasks.md 7.4: extracted from `test/packaging/entries.test.ts` (task 0.6/
// 5.6/G.4's RISK-5 detector) so `test/packaging/interop-exports.test.ts`
// (7.4) can reuse the SAME exports-resolution simulator and transitive
// import-graph walker instead of building a parallel implementation, per
// this session's explicit instruction. Behavior is unchanged from
// `entries.test.ts`'s original inline versions — this is a pure extraction,
// not a rewrite; `entries.test.ts` itself now imports from here too, so
// there is exactly one implementation of each algorithm in the repo.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * A minimal simulation of Node's PACKAGE_IMPORTS_EXPORTS_RESOLVE algorithm
 * (which TypeScript's exports-aware resolution mirrors), restricted to what
 * this package's `exports` shape actually needs: nested condition objects
 * with a `types` sub-condition, and a `default` fallback at every level.
 *
 * Node/TypeScript check an object's OWN keys in the order they appear in the
 * JSON, and take the FIRST key that is either `"default"` or an active
 * condition (see `entries.test.ts`'s original G.4 doc comment for the full
 * account of why this ordering-sensitivity matters).
 */
export function resolveExportsTarget(target: unknown, activeConditions: string[]): string | null {
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

/** Recursively lists every file (not directory) under `dir`, as paths relative to `dir`. */
export function walkFiles(dir: string): string[] {
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

/** Resolves a relative specifier to a real file within a package's compiled
 *  output tree, trying every shape builder-bob's per-file transpile output
 *  uses: the specifier as-is (already includes `.js`), `<path>.js`, and
 *  `<path>/index.js`. Returns `undefined` for a bare (non-relative)
 *  specifier — those are exactly what a banned/allowed-specifier check
 *  inspects directly, without trying to resolve them on disk. */
function resolveRelative(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) {
    return undefined;
  }
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base, `${base}.js`, path.join(base, 'index.js')];
  return candidates.find((c) => existsSync(c));
}

/** Walks every relative import transitively reachable from `entryFile`,
 *  across the whole resolved file set — a single entry file's own
 *  specifiers are not its transitive graph. Returns every specifier seen
 *  (bare AND relative) plus how many files were actually visited (used as a
 *  sanity guard against the walk silently degrading to a same-file-only
 *  check). */
export function walkTransitiveSpecifiers(entryFile: string): { allSpecifiers: Set<string>; visitedFiles: number } {
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

/** Every `types` condition target anywhere in a package's `exports` map,
 *  paired with the dotted path of the condition chain that reaches it (e.g.
 *  `./cli > default > types`). Walks the WHOLE tree rather than resolving a
 *  single condition set, because the defect class this guards against is "one
 *  subpath's `types` was authored by hand and points somewhere invalid" — a
 *  condition-by-condition resolution would only ever inspect the conditions
 *  the test author happened to think of. */
export function collectTypesTargets(
  exportsField: unknown,
  trail: string[] = [],
): { readonly path: string; readonly target: string }[] {
  if (!exportsField || typeof exportsField !== 'object') {
    return [];
  }
  const found: { path: string; target: string }[] = [];
  for (const [key, value] of Object.entries(exportsField as Record<string, unknown>)) {
    if (key === 'types' && typeof value === 'string') {
      found.push({ path: [...trail, key].join(' > '), target: value });
      continue;
    }
    found.push(...collectTypesTargets(value, [...trail, key]));
  }
  return found;
}
