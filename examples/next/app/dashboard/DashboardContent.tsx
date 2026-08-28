// examples/next/app/dashboard/DashboardContent.tsx
//
// tasks.md 8.3: the real, async-loaded dashboard content — an async server
// component that suspends (per React Suspense semantics) until its
// simulated fetch resolves, at which point Next.js swaps it in for the
// `<AutoSkeleton.SSR>` fallback (`../page.tsx`). Deliberately mirrors
// `dashboard-capture/page.tsx`'s visual shape (title / hero / two text
// lines) so the skeleton-to-content transition looks coherent — not
// required for REQ-SSR-4's correctness proof, but keeps the demo honest.

async function simulatedFetch(): Promise<{ title: string; body: string }> {
  // 1200ms gives `test/ssr/dashboard.spec.ts` a comfortable window to
  // inspect the pre-hydration/pre-swap fallback DOM deterministically,
  // without racing Playwright's `page.goto('load')` completion.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return { title: 'Q3 Revenue Dashboard', body: 'Real content loaded after the simulated fetch resolved.' };
}

export async function DashboardContent() {
  const data = await simulatedFetch();
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
