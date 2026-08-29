// cli/manifest.ts
//
// tasks.md 8.1: re-exports the manifest types from `src/web/ssr/manifest.ts`
// (the canonical, publicly-exported definition — see that file's header for
// why it lives under `src/web/ssr/` and not here) and adds `CaptureReport`,
// which is CLI-only (RISK-4's `--report` coverage signal; nothing in the
// runtime component reads it).

export type {
  AutoSkeletonSSRManifest,
  AutoSkeletonSSRManifestEntry,
} from '../src/web/ssr/manifest';
export { isReplayableManifest, SSR_MANIFEST_VERSION } from '../src/web/ssr/manifest';
export {
  assertSsrManifestIntegrity,
  computeSsrManifestIntegrity,
  SSR_BUILD_ATTRIBUTE,
  SSR_BUILD_CSS_VARIABLE,
} from '../src/web/ssr/integrity';

/** RISK-4's `--report` detection signal (task 8.1's Observability line):
 *  which `skeletonKey`s were captured vs. which failed this run. */
export interface CaptureReport {
  readonly capturedKeys: readonly string[];
  readonly failedKeys: readonly string[];
  readonly manifestPath: string;
  readonly cssBundlePath: string;
}
