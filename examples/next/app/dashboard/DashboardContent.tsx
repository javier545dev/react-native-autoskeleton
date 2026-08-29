// examples/next/app/dashboard/DashboardContent.tsx
//
// tasks.md 8.3: the real, async-loaded dashboard content — an async server
// component that suspends (per React Suspense semantics) until its
// simulated fetch resolves, at which point Next.js swaps it in for the
// `<AutoSkeleton.SSR>` fallback (`../page.tsx`). Deliberately mirrors
// `dashboard-capture/page.tsx`'s visual shape (title / hero / two text
// lines) so the skeleton-to-content transition looks coherent — not
// required for REQ-SSR-4's correctness proof, but keeps the demo honest.

/** 1200ms gives `test/ssr/dashboard.spec.ts` a comfortable window to inspect
 *  the pre-hydration/pre-swap fallback DOM deterministically, without racing
 *  Playwright's `page.goto('load')` completion. It stays the DEFAULT so that
 *  suite is unaffected. */
export const DEFAULT_FETCH_MS = 1200;
/** Clamped: this is a demo control, not a way to pin a server thread open. */
const MAX_FETCH_MS = 15_000;

/** The SSR skeleton is a SERVER-rendered `<Suspense>` fallback, so no client
 *  button can toggle it — by the time the browser has JavaScript, the swap has
 *  already happened. The only honest control is how long the server takes, so
 *  `/dashboard?delay=8000` holds the real skeleton on screen for 8 seconds. */
export function resolveFetchMs(raw: string | string[] | undefined): number {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isFinite(value) || value < 0) {
    return DEFAULT_FETCH_MS;
  }
  return Math.min(value, MAX_FETCH_MS);
}

async function simulatedFetch(delayMs: number): Promise<{ title: string; body: string }> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return { title: 'Q3 Revenue Dashboard', body: 'Real content loaded after the simulated fetch resolved.' };
}

export async function DashboardContent({ delayMs = DEFAULT_FETCH_MS }: { delayMs?: number }) {
  const data = await simulatedFetch(delayMs);
  return (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>{data.title}</h1>
      <div
        style={{
          width: '100%',
          height: 160,
          background: '#4f46e5',
          borderRadius: 8,
          marginBottom: 16,
        }}
      />
      <p>{data.body}</p>
    </div>
  );
}
