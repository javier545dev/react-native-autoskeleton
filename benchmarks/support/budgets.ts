// benchmarks/support/budgets.ts
//
// tasks.md 9.1 — loads benchmarks/budgets.json and exposes each `{value,
// source}` entry as a flat numeric field. The `source` strings stay in the
// JSON file (for a human auditing where a number came from); this loader
// intentionally returns only the numbers so call sites don't have to unwrap
// `.value` everywhere.

import { readFileSync } from 'node:fs';
import path from 'node:path';

const BUDGETS_PATH = path.join(__dirname, '..', 'budgets.json');

interface BudgetEntry {
  readonly value: number;
  readonly source: string;
}

interface RawBudgets {
  readonly traversalP95Ms: BudgetEntry;
  readonly cacheLookupP95Ms: BudgetEntry;
  readonly serializationP95Ms: BudgetEntry;
  readonly serializationRatioOfTraversalBudget: BudgetEntry;
  readonly droppedFramesPerScroll: BudgetEntry;
  readonly webEntryGzipBytes: BudgetEntry;
  readonly maxRegressionRatio: BudgetEntry;
  readonly nativeHeapGrowthBytesRecycleStress: BudgetEntry;
}

export interface Budgets {
  readonly traversalP95Ms: number;
  readonly cacheLookupP95Ms: number;
  readonly serializationP95Ms: number;
  readonly serializationRatioOfTraversalBudget: number;
  readonly droppedFramesPerScroll: number;
  readonly webEntryGzipBytes: number;
  readonly maxRegressionRatio: number;
  readonly nativeHeapGrowthBytesRecycleStress: number;
}

let cached: Budgets | undefined;

export function loadBudgets(): Budgets {
  if (cached) {
    return cached;
  }
  const raw = JSON.parse(readFileSync(BUDGETS_PATH, 'utf8')) as RawBudgets;
  cached = {
    traversalP95Ms: raw.traversalP95Ms.value,
    cacheLookupP95Ms: raw.cacheLookupP95Ms.value,
    serializationP95Ms: raw.serializationP95Ms.value,
    serializationRatioOfTraversalBudget: raw.serializationRatioOfTraversalBudget.value,
    droppedFramesPerScroll: raw.droppedFramesPerScroll.value,
    webEntryGzipBytes: raw.webEntryGzipBytes.value,
    maxRegressionRatio: raw.maxRegressionRatio.value,
    nativeHeapGrowthBytesRecycleStress: raw.nativeHeapGrowthBytesRecycleStress.value,
  };
  return cached;
}
