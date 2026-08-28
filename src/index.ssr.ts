// src/index.ssr.ts
//
// tasks.md 8.3 / NFR-6: the `autoskeleton/ssr` subpath — SSR replay support
// (`<AutoSkeletonSSR>`, the client hydration bridge, and the manifest types
// the capture CLI writes). Kept OUT of the `.` entry (`index.web.ts`)
// deliberately: it is a genuinely opt-in, Next.js-specific feature (the same
// reasoning `autoskeleton/uniwind` already established for theming
// interops), and `test/packaging/web-bundle.test.ts` measures NFR-6 by
// bundling the ENTIRE `.` entry in Vite library mode, which retains every
// export regardless of use — see `index.web.ts`'s doc comment for the
// measured before/after. A consumer wires SSR by importing from this
// subpath in the one server-component file that needs it, never from `.`.

export { AutoSkeletonSSR } from './web/ssr/AutoSkeletonSSR';
export type { AutoSkeletonSSRProps } from './web/ssr/AutoSkeletonSSR';
export { AutoSkeletonSSRHydrate } from './web/ssr/hydrate';
export type { AutoSkeletonSSRHydrateProps } from './web/ssr/hydrate';
export type { AutoSkeletonSSRManifest, AutoSkeletonSSRManifestEntry } from './web/ssr/manifest';
export { SSR_MANIFEST_VERSION } from './web/ssr/manifest';
