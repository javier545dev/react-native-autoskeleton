// src/web/ssr/uncaptured-warning.test.ts
//
// tasks.md 8.3 (Observability line) / RISK-4: pure-formatter unit coverage,
// mirroring `core/metrics.ts`'s own `formatXWarning` test convention.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emitUncapturedSkeletonKeyWarning, formatUncapturedSkeletonKeyWarning } from './uncaptured-warning';

describe('formatUncapturedSkeletonKeyWarning', () => {
  it('names the exact uncaptured skeletonKey and the actionable fix', () => {
    const message = formatUncapturedSkeletonKeyWarning('dashboard');
    expect(message).toContain('"dashboard"');
    expect(message).toContain('AutoSkeleton.SSR');
    expect(message).toContain('capture CLI');
  });
});

describe('emitUncapturedSkeletonKeyWarning', () => {
  const originalEnv = process.env['NODE_ENV'];

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env['NODE_ENV'] = originalEnv;
  });

  it('warns in a non-production environment', () => {
    process.env['NODE_ENV'] = 'development';
    emitUncapturedSkeletonKeyWarning('new-widget');
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('new-widget'));
  });

  it('stays silent in production', () => {
    process.env['NODE_ENV'] = 'production';
    emitUncapturedSkeletonKeyWarning('new-widget');
    expect(console.warn).not.toHaveBeenCalled();
  });
});
