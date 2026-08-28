// examples/next/app/dashboard-capture/page.tsx
//
// tasks.md 8.1/8.3: the CAPTURE ROUTE for the `dashboard` skeletonKey
// (declared in `../../autoskeleton.capture-registry.json`, resolved by
// `cli/capture.ts`'s registry). Renders the SAME visual shape as the real
// dashboard's loading state, wrapped in `#autoskeleton-capture-root` — the
// element the capture CLI's injected DOM sensor traverses. This route is
// build-time-only tooling; it is never linked from the app's own navigation.

export default function DashboardCapturePage() {
  return (
    <div id="autoskeleton-capture-root" style={{ padding: 24, maxWidth: 640 }}>
      <div style={{ width: 220, height: 32, background: '#ccc', borderRadius: 4, marginBottom: 16 }} />
      <div style={{ width: '100%', height: 160, background: '#ccc', borderRadius: 8, marginBottom: 16 }} />
      <div style={{ width: '90%', height: 16, background: '#ccc', borderRadius: 4, marginBottom: 8 }} />
      <div style={{ width: '70%', height: 16, background: '#ccc', borderRadius: 4 }} />
    </div>
  );
}
