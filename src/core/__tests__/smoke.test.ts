import { describe, expect, it } from 'vitest';

// Task 0.2 (tasks.md Phase 0): proves the Vitest runner actually executes against
// `src/core/` under the strict tsconfig, in a `node` environment with no DOM shim.
// This file is deliberately temporary scaffolding, not a spec for real behaviour —
// it is deleted once 1.1 lands and `cache-key.test.ts` becomes the first real
// RED→GREEN test in `src/core/`.
//
// The failure path was verified manually during Phase 0 apply (not committed here,
// since a permanently-red test would break every later CI run for no production
// reason): a temporary `expect(1).toBe(2)` assertion was run and Vitest reported it
// as a failed test with the expected/actual diff, a non-zero exit code, and the
// correct file/line pointer — see the apply report for the exact transcript.
describe('vitest smoke (core, node env)', () => {
  it('executes in a real node environment with no DOM global', () => {
    // Read via globalThis (not bare `window`/`document` identifiers) so this
    // compiles cleanly under the project's DOM-free tsconfig (ADR-4: src/core/
    // has zero platform imports) while still asserting the runtime property.
    const globals = globalThis as Record<string, unknown>;
    expect(typeof globals.window).toBe('undefined');
    expect(typeof globals.document).toBe('undefined');
  });

  it('runs strict-mode TypeScript source through the shared tsconfig', () => {
    const add = (a: number, b: number): number => a + b;
    expect(add(2, 3)).toBe(5);
  });
});
