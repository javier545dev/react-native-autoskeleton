// src/lint/banned-css-properties.test.ts
//
// ADR-6 (plan.md): "The shimmer animates `transform` only. `background-
// position` is banned from the entire codebase." `background-position`
// requires a main-thread repaint, which would stall the shimmer the instant
// the JS thread blocks — defeating NFR-2 outright.
//
// No ESLint (or any other lint toolchain) is configured anywhere in this repo
// yet — Phase 0 scaffolded Vitest + Playwright only, no lint task exists in
// tasks.md Phase 0-1. This Vitest suite is therefore the "lint rule" half of
// ADR-6's two-part guard (a static, whole-`src/` source scan that fails the
// build the same way a lint rule would); task 2.2's Playwright suite
// (test/web/css-renderer.spec.ts) provides the second half, asserting the
// ACTUAL rendered/computed CSS in a real browser never uses the property.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = path.resolve(__dirname, '..');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.css']);
const BANNED_PROPERTY = 'background-position';
/** Files whose own source legitimately contains the banned string as test
 *  infrastructure — this file's own `BANNED_PROPERTY` constant/assertions,
 *  and `css-renderer.test.ts`'s assertions that the GENERATED stylesheet
 *  never contains it. Both are checks FOR the ban, not violations of it. */
const SELF_TEST_EXCLUSIONS = new Set([
  path.resolve(__dirname, 'banned-css-properties.test.ts'),
  path.resolve(SRC_ROOT, 'web/css-renderer.test.ts'),
]);

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry))) {
      files.push(full);
    }
  }
  return files;
}

/** Strips `//` and `/* *\/` comments so this rule can ban REAL usage of the
 *  property (a CSS declaration or a string/template literal building one)
 *  without also flagging the doc comments — this file's own included — that
 *  legitimately name `background-position` while explaining the ban. A real
 *  ESLint rule would work off the parsed AST instead of text; this is the
 *  source-level equivalent available without adding a lint toolchain. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const sourceFiles = collectSourceFiles(SRC_ROOT).filter((f) => !SELF_TEST_EXCLUSIONS.has(f));

describe('ADR-6 lint rule: background-position is banned from src/', () => {
  it('scanned at least one source file (the check has something to inspect)', () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  it.each(sourceFiles)('%s does not use background-position outside comments', (file) => {
    const code = stripComments(readFileSync(file, 'utf8')).toLowerCase();
    expect(code).not.toContain(BANNED_PROPERTY);
  });
});
