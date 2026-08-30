import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadBudgets } from '../../benchmarks/support/budgets';
import { measureWebEntryAsConsumerApp, WEB_ENTRY, type WebEntryBundle } from './helpers/web-bundle';

// Task 2.5 (tasks.md Phase 2): NFR-6 — "the web entry (`.`, no theming
// interops) is < 9 kB gzip with no runtime dependency beyond React." ADR-3's
// own caveat is load-bearing here: this MUST be measured on a real consumer
// BUNDLE (tree-shaken, minified), never on builder-bob's output, which is an
// unbundled, unminified per-file transpile and would give a meaningless
// number in either direction (plan.md §7.6, ADR-3).
//
// The measurement itself lives in `./helpers/web-bundle.ts` and the budget in
// `benchmarks/budgets.json`, because this gate and the CI benchmark suite must
// report the SAME number for the same NFR. They did not: the gate's ruler was
// corrected to an app build (revision 3 below) while
// `benchmarks/support/web-benchmarks.ts` kept measuring a Vite LIBRARY build,
// so the benchmark reported 9418 B against a stale 9216 B budget while this
// gate read 7712 B against 7933 B — 1706 bytes apart, both green, describing
// different things. `budgets.json` had even predicted the failure in a comment
// ("both must be changed together or they will silently diverge"). A comment
// is not a mechanism; one shared function and one shared constant are.
//
// Run in isolation: `vitest run test/packaging/web-bundle.test.ts`.

// NFR-6 has been revised TWICE, corrected once, and relaxed once. The current
// number lives in `benchmarks/budgets.json` (`webEntryGzipBytes`) — this file
// reads it rather than restating it. The full record:
//   1. 5 kB -> 8 kB (2026-08-27): the original 5 kB came from the kickoff
//      prompt and was never validated against an implementation. First real
//      measurement was 7566 B gzip, dominated by product code (AutoSkeleton,
//      dom-sensor, css-renderer), not incidental bloat.
//   2. 8 kB -> 9 kB (2026-08-28): the 8 kB gate DID its job — it forced a
//      design decision instead of letting the bundle grow silently — but the
//      decision it forced was giving web a DIFFERENT typed-hint API from
//      native (no `<AutoSkeleton.Hint>` on web, only a raw `data-*`
//      attribute), landing at 8185/8192 B, 7 bytes of headroom. A per-platform
//      API asymmetry is a worse outcome than ~250 bytes for a library whose
//      entire proposition is "one package, all platforms" — raised
//      deliberately to buy back API symmetry (`src/web/Hint.tsx`), not
//      because the gate was inconvenient. See spec.md NFR-6 for the full
//      rationale and plan.md §11 item 5 for the resolved open question.
//   3. NOT a revision — a MEASUREMENT CORRECTION (2026-08-29, G.18). The
//      budget was never relaxed; the ruler was wrong. See
//      `./helpers/web-bundle.ts` for why a library build is not what a
//      consumer downloads. On identical input the same bundle measured 9023 B
//      as a library and 7474 B as an app. The budget was re-derived to keep
//      the gate EXACTLY as strict as it was, so this bought zero room: the
//      last library-mode run measured 8995 B against 9216, i.e. 221 B of real
//      headroom, and 7475 + 221 = 7696.
//   4. 7696 -> 7933 (2026-08-29), by maintainer decision. **A RELAXATION, not
//      another correction** — entry 3 was the ruler being wrong; this one is
//      the budget genuinely moving, and a fifth change has to argue against
//      BOTH precedents.
//      Bought: two real user-facing defects, neither of which had a gate.
//      (a) A snapshot measured before its content had layout — an `<img>` with a
//      0x0 box — was cached with ZERO shapes, and since the replay reuses the
//      same cache key, that empty skeleton replayed forever. (b)
//      `useOverlayRenderer` destroyed its handle only on UNMOUNT, so after a
//      completed handoff the handle pointed at a detached subtree and every
//      later cycle announced loading while painting nothing.
//      Cost 99 B: 7613 -> 7712. The budget is 7712 + 221, restoring the SAME
//      working headroom the corrected gate began with, rather than the
//      measured need — 7712 exactly would be a gate with zero headroom that
//      fails on the next commit, which is the argument revision 2 already made
//      against accepting 7 bytes.
//   5. NOT a revision — the number MOVED FILE (2026-08-30). It now lives in
//      `benchmarks/budgets.json` so the CI benchmark and this gate cannot
//      report different budgets for one NFR ever again. Same value, one home.
// This remains a HARD FAILING GATE, not a downgrade to a tracked budget.
const NFR6_BUDGET_BYTES = loadBudgets().webEntryGzipBytes;

let bundle: WebEntryBundle;

beforeAll(async () => {
  // `lib/` is rebuilt from current `src/` exactly once, in Vitest's
  // `globalSetup` (see `test/packaging/global-setup.ts`), strictly before this
  // file's `beforeAll` runs — NOT here. Running `bob build` again in this
  // file's own `beforeAll` would re-race with `entries.test.ts`'s `npm pack`,
  // which is the exact structural hazard `global-setup.ts` exists to close.
  if (!existsSync(WEB_ENTRY)) {
    throw new Error(`Expected ${WEB_ENTRY} after 'bob build' — builder-bob output is missing.`);
  }
  bundle = await measureWebEntryAsConsumerApp();
}, 120_000);

afterAll(() => {
  bundle?.cleanup();
});

describe('NFR-6: web entry gzip budget (measured on a real, fully minified consumer app bundle)', () => {
  it('produces a bundle file', () => {
    expect(bundle.rawBytes).toBeGreaterThan(0);
  });

  it('the bundle never contains a react-native/Skia/Reanimated specifier (ADR-3 consequence)', () => {
    const source = bundle.source.toString('utf8');
    for (const banned of ['react-native', '@shopify/react-native-skia', 'react-native-reanimated']) {
      expect(source).not.toContain(banned);
    }
  });

  it('DebugOverlay is tree-shaken out of a production build (task 2.4 DoD)', () => {
    const source = bundle.source.toString('utf8');
    expect(source).not.toContain('askl-debug-overlay');
    expect(source).not.toContain('askl-debug-shape');
  });

  it('is under the NFR-6 gzip budget, measured as a consumer app bundle (failing gate; budget revised 2026-08-27 and 2026-08-28, measurement corrected 2026-08-29)', () => {
    // eslint-disable-next-line no-console
    console.log(
      `[NFR-6] autoskeleton web entry: ${bundle.rawBytes} bytes raw, ${bundle.gzipBytes} bytes gzip ` +
        `(budget: ${NFR6_BUDGET_BYTES} bytes, from benchmarks/budgets.json)`,
    );
    expect(bundle.gzipBytes).toBeLessThan(NFR6_BUDGET_BYTES);
  });
});
