// cli/peer-dependency.test.ts
//
// RED-first unit tests for `isModuleNotFoundFor` (RISK-5 packaging fix —
// see `cli/peer-dependency.ts`'s header comment).

import { describe, expect, it } from 'vitest';
import { isModuleNotFoundFor } from './peer-dependency';

function moduleNotFoundError(specifier: string): NodeJS.ErrnoException {
  const error = new Error(
    `Cannot find module '${specifier}'\nRequire stack:\n- /some/path/cli/capture.js`,
  ) as NodeJS.ErrnoException;
  error.code = 'MODULE_NOT_FOUND';
  return error;
}

describe('isModuleNotFoundFor', () => {
  it('returns true for a genuine MODULE_NOT_FOUND naming the exact specifier', () => {
    expect(isModuleNotFoundFor(moduleNotFoundError('@playwright/test'), '@playwright/test')).toBe(true);
  });

  it('returns true for ERR_MODULE_NOT_FOUND (ESM resolution) naming the exact specifier', () => {
    const error = new Error(`Cannot find package '@playwright/test'`) as NodeJS.ErrnoException;
    error.code = 'ERR_MODULE_NOT_FOUND';
    expect(isModuleNotFoundFor(error, '@playwright/test')).toBe(true);
  });

  it('returns false when MODULE_NOT_FOUND names a DIFFERENT specifier (a transitive dependency of the target module, not the target module itself)', () => {
    // e.g. @playwright/test resolved, but ITS OWN dependency failed to
    // resolve — this must propagate as a real error, never be mislabeled as
    // "install @playwright/test".
    expect(isModuleNotFoundFor(moduleNotFoundError('playwright-core'), '@playwright/test')).toBe(false);
  });

  it('returns false for a non-MODULE_NOT_FOUND error', () => {
    const error = new Error('some unrelated failure') as NodeJS.ErrnoException;
    error.code = 'EACCES';
    expect(isModuleNotFoundFor(error, '@playwright/test')).toBe(false);
  });

  it('returns false for a non-Error value', () => {
    expect(isModuleNotFoundFor('not an error', '@playwright/test')).toBe(false);
    expect(isModuleNotFoundFor(null, '@playwright/test')).toBe(false);
    expect(isModuleNotFoundFor(undefined, '@playwright/test')).toBe(false);
  });
});
