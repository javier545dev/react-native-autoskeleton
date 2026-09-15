// test/packaging/web-bundle-single-source.test.ts
//
// NFR-6 was measured in two places and drifted, exactly as `budgets.json`'s own
// comment predicted it would: "Identical to test/packaging/web-bundle.test.ts's
// NFR6_BUDGET_BYTES — both must be changed together or they will silently
// diverge." When the gate's measurement was corrected from a Vite LIBRARY build
// to a consumer APP build (4dae7c0), the benchmark copy was not, so one
// requirement was reported two ways — 9418 B against a 9216 B budget in the
// benchmark, 7712 B against 7933 B in the gate. Both green. 1706 bytes apart.
//
// The file had predicted its own failure mode, in writing, and the prediction
// did not prevent it — because a comment asks a human to remember, and this one
// asked four different files to be edited together. These assertions do not ask
// anyone to remember anything: there is one measurement function and one budget
// constant, and re-introducing a second copy of either fails here.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBudgets } from '../../benchmarks/support/budgets';

const REPO_ROOT = path.resolve(__dirname, '../..');

const SHARED_MEASUREMENT = 'test/packaging/helpers/web-bundle.ts';
/** Every file that reports an NFR-6 number to a human or a gate. */
const CONSUMERS = ['test/packaging/web-bundle.test.ts', 'benchmarks/support/web-benchmarks.ts'] as const;

function sourceOf(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

/** Comments carry the revision history and must be free to quote old numbers;
 *  only executable text is checked for a second copy of the budget. */
function codeOf(relativePath: string): string {
  return sourceOf(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('NFR-6 is measured in exactly one place', () => {
  it.each(CONSUMERS)('%s does not configure its own bundler build', (file) => {
    const code = codeOf(file);
    expect(
      code,
      `${file} builds its own bundle instead of calling measureWebEntryAsConsumerApp() from ` +
        `${SHARED_MEASUREMENT}. A second build configuration is how the library-mode vs app-mode ` +
        'divergence happened; there must be exactly one.',
    ).not.toMatch(/import\(\s*['"]vite['"]\s*\)/);
    expect(code, `${file} configures rollup directly`).not.toContain('rollupOptions');
  });

  it.each(CONSUMERS)('%s obtains its measurement from the shared helper', (file) => {
    expect(sourceOf(file)).toContain('measureWebEntryAsConsumerApp');
  });

  it('only the shared helper gzips the web entry', () => {
    expect(codeOf(SHARED_MEASUREMENT)).toContain('gzipSync');
    for (const file of CONSUMERS) {
      expect(codeOf(file), `${file} gzips a bundle of its own`).not.toContain('gzipSync');
    }
  });
});

describe('the NFR-6 budget has exactly one home', () => {
  it('benchmarks/budgets.json is where the number lives', () => {
    expect(loadBudgets().webEntryGzipBytes).toBeGreaterThan(0);
  });

  it.each(CONSUMERS)('%s hardcodes no byte budget of its own', (file) => {
    const budget = loadBudgets().webEntryGzipBytes;
    const code = codeOf(file);
    expect(
      code,
      `${file} contains the literal ${budget}. Read it from benchmarks/budgets.json through ` +
        'loadBudgets() instead — a second copy is a second thing to forget to update.',
    ).not.toContain(String(budget));
    // Every historical NFR-6 figure, so "restoring" one as a literal is caught
    // too rather than only the current value.
    for (const retired of [5120, 8192, 9216, 7696, 7712]) {
      expect(code, `${file} contains the retired NFR-6 figure ${retired} as a literal`).not.toContain(
        String(retired),
      );
    }
  });

  it('the gate reads the budget rather than restating it', () => {
    expect(codeOf('test/packaging/web-bundle.test.ts')).toContain('loadBudgets()');
  });
});
