// cli/index.ts
//
// tasks.md 9.5 — the public programmatic entrypoint for `autoskeleton/cli`
// (the `./cli` package export). Phase 8 deliberately deferred CLI packaging
// (`files`/`exports['./cli']`/`bin`) to this task; before this file existed,
// `cli/capture.ts` was importable only from inside this repo, never from an
// installed `autoskeleton` package — see `docs/ssr-capture-cli.md`'s
// "Programmatic API" section, which this barrel makes true.
//
// Re-exports only the PUBLIC surface a consumer's build script needs —
// `route-safety.ts`/`bundle.ts`/`browser-runtime.ts` stay internal
// implementation detail, not re-exported here.

export { runCapture, CaptureFailedError } from './capture';
export type { CaptureRegistry, RunCaptureOptions, RunCaptureResult } from './capture';
export type { AutoSkeletonSSRManifest, AutoSkeletonSSRManifestEntry, CaptureReport } from './manifest';
export { SSR_MANIFEST_VERSION } from './manifest';
export { bucketRanges, buildSsrCssBundle } from './media-bundle';
export type { BucketRange, BuildSsrCssBundleOptions } from './media-bundle';
