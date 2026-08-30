// benchmarks/support/budgets.test.ts — RED first (tasks.md 9.1).
//
// WHY THESE ASSERTIONS NO LONGER CARRY LITERAL BUDGET FIGURES. The previous
// version of this file hardcoded `expect(budgets.webEntryGzipBytes).toBe(9216)`
// under the heading "no silent divergence" — and it was itself a THIRD copy of
// a number that already lived in `budgets.json` and in
// `test/packaging/web-bundle.test.ts`. It passed happily for the entire period
// during which the gate and the benchmark were measuring the same NFR 1706
// bytes apart, because "the JSON still says 9216" was never the thing at risk.
//
// A loader test's job is the LOADER: that every `{value, source}` entry is
// unwrapped, that nothing is dropped, and that the numbers reaching call sites
// are the numbers in the file. Restating the file's contents inline tests
// nothing and adds one more place to forget.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBudgets } from './budgets';

const RAW_BUDGETS = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'budgets.json'), 'utf8'),
) as Record<string, { value?: number; source?: string } | unknown>;

function rawEntries(): Array<[string, { value: number; source: string }]> {
  return Object.entries(RAW_BUDGETS).filter(([key]) => !key.startsWith('$') && !key.startsWith('_')) as Array<
    [string, { value: number; source: string }]
  >;
}

describe('loadBudgets', () => {
  it('unwraps every {value, source} entry in budgets.json to a flat number', () => {
    const budgets = loadBudgets() as unknown as Record<string, number>;
    const entries = rawEntries();

    expect(entries.length).toBeGreaterThan(0);
    for (const [key, entry] of entries) {
      expect(budgets[key], `${key} is missing from the loaded budgets`).toBe(entry.value);
    }
  });

  it('exposes no budget the JSON does not declare', () => {
    const loaded = Object.keys(loadBudgets());
    expect(loaded.sort()).toEqual(rawEntries().map(([key]) => key).sort());
  });

  it('requires every budget to cite where its number came from', () => {
    for (const [key, entry] of rawEntries()) {
      expect(typeof entry.value, `${key}.value`).toBe('number');
      expect(entry.source?.length ?? 0, `${key}.source is empty`).toBeGreaterThan(0);
    }
  });

  it('is the single home of the NFR-6 web bundle budget', () => {
    // `test/packaging/web-bundle.test.ts` reads this same loader rather than
    // declaring its own constant; `test/packaging/web-bundle-single-source.test.ts`
    // is what fails if a second copy is reintroduced anywhere.
    expect(loadBudgets().webEntryGzipBytes).toBe(
      (RAW_BUDGETS['webEntryGzipBytes'] as { value: number }).value,
    );
  });
});
