import type { Metadata } from "next";
import { AutoSkeletonSSRHydrate } from "autoskeleton/ssr";
import "./globals.css";
// tasks.md 8.3 (REQ-SSR-3): the `@media`-bucketed CSS bundle the capture CLI
// wrote — one global import, so a single server-rendered payload is correct
// at every width without this app ever guessing the viewport.
import "../generated/autoskeleton-ssr/bundle.css";
import { manifest } from "../generated/autoskeleton-ssr";

// No downloaded webfont. This app previously imported Geist Sans and Geist
// Mono from `next/font/google` and then painted neither: `globals.css` forced
// `Arial, Helvetica, sans-serif` on `body`, so two font families were fetched
// on every route and thrown away. The type scale now maps `--font-sans` and
// `--font-mono` to the system stacks in `globals.css`, which is also what the
// other three example apps use — one less thing that can differ between the
// renderers for a reason nobody chose.

export const metadata: Metadata = {
  title: "autoskeleton — SSR demos",
  description:
    "Server-rendered autoskeleton: geometry captured at build time by the capture CLI and replayed as a Suspense fallback, with zero hydration mismatch.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // Deliberately unchanged: everything in here runs on EVERY route, including
  // the four chromeless ones `test/ssr/dashboard.spec.ts` asserts against. The
  // shell lives in `app/_demo/DemoShell.tsx` instead, which those four routes
  // do not import.
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        {/* tasks.md 8.3: client hydration bridge — imports the capture CLI's
            build-time snapshots into the runtime ShapeStore ONCE, so a later
            CLIENT-side-only re-render of the same skeletonKey (e.g. a client
            navigation elsewhere in the app) gets a real cache hit instead of
            a fresh cold traversal. */}
        <AutoSkeletonSSRHydrate manifest={manifest} />
      </body>
    </html>
  );
}
