#!/usr/bin/env node
// cli/capture.ts
//
// tasks.md 8.1 / spec REQ-SSR-2: the build-time snapshot capture CLI.
// Playwright-driven, runs the real production DOM sensor (task 2.1) inside
// headless Chromium across a developer-declared `skeletonKey -> route`
// registry (ASSUMPTION plan.md §11.1, spec Open Question 1), N width buckets
// x [ltr,rtl], and writes a serializable manifest (`cli/manifest.ts`) plus
// the `@media`-bucketed CSS bundle (task 8.2, `cli/media-bundle.ts`).
//
// Threat matrix (plan.md §8, "Capture-CLI subprocess & route handling" — the
// one applicable row): routes are resolved against a single `baseURL` and
// rejected on origin mismatch or a literal `../` (`route-safety.ts`);
// Chromium is launched through the Playwright API, never a shell string, so
// metacharacters in a route are inert; every navigation is bounded by
// `navigationTimeoutMs`; a run with ANY failed key writes NOTHING, so a
// previously-captured good bundle is never overwritten by a partial one.
//
// Observability: `report.capturedKeys`/`report.failedKeys` is the RISK-4
// coverage signal; a dev-mode console warning naming each uncaptured
// `skeletonKey` at RUNTIME (not build time) is `<AutoSkeleton.SSR>`'s job
// (task 8.3). Performance: N/A — build-time tool, not part of any runtime NFR.

import { mkdir, writeFile } from 'node:fs/promises';
// `@playwright/test` is an OPTIONAL peerDependency, not an eager
// `dependencies` entry (RISK-5 packaging fix, orchestrator-found defect —
// see `test/packaging/entries.test.ts`'s "no runtime `dependencies`
// footprint" guard). A static top-level `import { chromium } from
// '@playwright/test'` would `require()` it unconditionally at module load,
// throwing a raw `MODULE_NOT_FOUND` for a consumer who only imports
// `runCapture`'s types. `type import(...)` is erased at compile time
// (zero runtime cost); the real value is loaded lazily by `loadChromium`
// below, at the point of use, with an actionable error when the peer is
// missing (ADR-15's discipline, applied to the CLI).
import type { chromium as ChromiumLauncher } from '@playwright/test';
import { WIDTH_BUCKETS } from '../src/core/cache-key';
import { DEFAULT_BUDGET_MS, DEFAULT_MAX_SHAPES } from '../src/core/metrics';
import type { Direction } from '../src/core/types';
import { computeSsrManifestIntegrity } from '../src/web/ssr/integrity';
import { bundleCaptureRuntime } from './bundle';
import { buildSsrCssBundle } from './media-bundle';
import type { AutoSkeletonSSRManifest, AutoSkeletonSSRManifestEntry, CaptureReport } from './manifest';
import { SSR_MANIFEST_VERSION } from './manifest';
import { isModuleNotFoundFor } from './peer-dependency';
import { resolveCaptureUrl, resolveOutputFile } from './route-safety';

const PLAYWRIGHT_PEER_SPECIFIER = '@playwright/test';

/** Loads `@playwright/test`'s `chromium` launcher lazily (see the import
 *  comment above). Throws a named, actionable error — naming exactly what
 *  to install — instead of letting a raw `MODULE_NOT_FOUND` surface when
 *  the optional peer is missing. Any OTHER failure (including a
 *  `MODULE_NOT_FOUND` thrown by one of `@playwright/test`'s own missing
 *  transitive dependencies) propagates unchanged. */
function loadChromium(): typeof ChromiumLauncher {
  let playwright: typeof import('@playwright/test');
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    playwright = require(PLAYWRIGHT_PEER_SPECIFIER) as typeof import('@playwright/test');
  } catch (error) {
    if (isModuleNotFoundFor(error, PLAYWRIGHT_PEER_SPECIFIER)) {
      throw new Error(
        'autoskeleton capture CLI requires the optional peer dependency ' +
          `"${PLAYWRIGHT_PEER_SPECIFIER}" to drive headless Chromium, but it is not installed. ` +
          'Install it and its browser binary:\n\n' +
          `  npm install ${PLAYWRIGHT_PEER_SPECIFIER}\n` +
          '  npx playwright install chromium\n\n' +
          'See docs/ssr-capture-cli.md for details.',
      );
    }
    throw error;
  }
  return playwright.chromium;
}
// Task 9.5 packaging fix: `browser-runtime.ts` is never IMPORTED at runtime
// (`bundle.ts` resolves it as a raw file path for esbuild, at runtime, via
// `__dirname` — see that file's header) but its `declare global { interface
// Window { __autoskeletonCapture__ } }` augmentation is what makes the
// `window.__autoskeletonCapture__.captureRoot(...)` call inside
// `page.evaluate` below typecheck at all. In THIS repo, `tsconfig.tests.json`
// papers over the gap by including the whole `cli/` directory as program
// roots regardless of import chains. A real external consumer typechecking
// only `import { runCapture } from 'autoskeleton/cli'` has no such
// repo-wide include and got a genuine `Property '__autoskeletonCapture__'
// does not exist` error — caught by actually typechecking from a fresh
// `npm install`'d consumer, not assumed. This `import type {}` is erased at
// runtime (zero behavior change) and pulls the ambient augmentation into
// every consumer's program.
import type {} from './browser-runtime';

export const DEFAULT_CAPTURE_ROOT_SELECTOR = '#autoskeleton-capture-root';
export const DEFAULT_NAVIGATION_TIMEOUT_MS = 15_000;
export const DEFAULT_CAPTURE_RADIUS = 4;
export const MANIFEST_FILE_NAME = 'manifest.json';
export const CSS_BUNDLE_FILE_NAME = 'bundle.css';
const CAPTURE_VIEWPORT_HEIGHT = 2000;
const DEFAULT_DIRECTIONS: readonly Direction[] = ['ltr', 'rtl'];

/** `skeletonKey -> route` (ASSUMPTION plan.md §11.1: declared registry, no
 *  route auto-discovery — RISK-4). `route` is resolved against `baseURL` by
 *  `resolveCaptureUrl`, never shell-interpreted. */
export type CaptureRegistry = Readonly<Record<string, string>>;

export interface RunCaptureOptions {
  readonly baseURL: string;
  readonly registry: CaptureRegistry;
  readonly outDir: string;
  readonly widthBuckets?: readonly number[];
  readonly directions?: readonly Direction[];
  /** CSS selector for the element each capture route wraps its loading-state
   *  markup in. Defaults to `#autoskeleton-capture-root`. */
  readonly rootSelector?: string;
  readonly navigationTimeoutMs?: number;
  readonly defaultRadius?: number;
  readonly budgetMs?: number;
  readonly maxShapes?: number;
}

export interface RunCaptureResult {
  readonly manifest: AutoSkeletonSSRManifest;
  readonly report: CaptureReport;
}

/** Thrown when one or more registry keys failed to capture. Per the threat
 *  matrix's "empty/partial capture never overwrites a previously good
 *  bundle" case, `runCapture` throws this BEFORE writing anything to
 *  `outDir` when `skeletonKeys` is non-empty — an existing manifest/bundle
 *  from a prior successful run is left exactly as it was. */
export class CaptureFailedError extends Error {
  constructor(readonly skeletonKeys: readonly string[], readonly manifest: AutoSkeletonSSRManifest) {
    super(
      `autoskeleton capture failed for skeletonKey(s): ${skeletonKeys.join(', ')} — ` +
        'no manifest or CSS bundle was written (a partial capture never overwrites a good one).',
    );
    this.name = 'CaptureFailedError';
  }
}

interface CaptureTask {
  readonly skeletonKey: string;
  readonly url: URL;
  readonly direction: Direction;
  readonly widthBucket: number;
}

/** Runs the build-time capture CLI (task 8.1). Resolves and validates every
 *  registry route up front (fail fast, before a browser is even launched),
 *  then captures the full `registry x widthBuckets x directions`
 *  cross-product with a single headless Chromium instance, and finally
 *  writes `manifest.json` + `bundle.css` to `outDir` — but only when every
 *  task in the cross-product succeeded. */
export async function runCapture(options: RunCaptureOptions): Promise<RunCaptureResult> {
  const widthBuckets = options.widthBuckets ?? WIDTH_BUCKETS;
  const directions = options.directions ?? DEFAULT_DIRECTIONS;
  const rootSelector = options.rootSelector ?? DEFAULT_CAPTURE_ROOT_SELECTOR;
  const navigationTimeoutMs = options.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS;
  const defaultRadius = options.defaultRadius ?? DEFAULT_CAPTURE_RADIUS;
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const maxShapes = options.maxShapes ?? DEFAULT_MAX_SHAPES;

  // Resolve + validate every route BEFORE launching a browser at all — the
  // threat-matrix's cross-origin / `../` rejections must never spend a
  // Chromium launch on an already-invalid registry entry.
  const tasks: CaptureTask[] = [];
  for (const [skeletonKey, route] of Object.entries(options.registry)) {
    const url = resolveCaptureUrl(options.baseURL, route);
    for (const direction of directions) {
      for (const widthBucket of widthBuckets) {
        tasks.push({ skeletonKey, url, direction, widthBucket });
      }
    }
  }

  const bundle = await bundleCaptureRuntime();
  const chromium = loadChromium();
  const browser = await chromium.launch();
  const entries: AutoSkeletonSSRManifestEntry[] = [];
  const failedKeys = new Set<string>();

  try {
    for (const task of tasks) {
      const context = await browser.newContext({
        viewport: { width: task.widthBucket, height: CAPTURE_VIEWPORT_HEIGHT },
      });
      try {
        const page = await context.newPage();
        await page.goto(task.url.toString(), { timeout: navigationTimeoutMs, waitUntil: 'load' });
        await page.evaluate((dir) => {
          document.documentElement.setAttribute('dir', dir);
        }, task.direction);
        await page.evaluate(() => document.fonts.ready);
        await page.addScriptTag({ content: bundle });
        const serialized = await page.evaluate(
          ({ selector, skeletonKey, widthBucket, budgetMs: b, maxShapes: m, defaultRadius: r }) =>
            window.__autoskeletonCapture__.captureRoot(selector, {
              skeletonKey,
              widthBucket,
              budgetMs: b,
              maxShapes: m,
              defaultRadius: r,
            }),
          {
            selector: rootSelector,
            skeletonKey: task.skeletonKey,
            widthBucket: task.widthBucket,
            budgetMs,
            maxShapes,
            defaultRadius,
          },
        );
        if (serialized === null) {
          throw new Error(
            `Capture root "${rootSelector}" was not found (or not laid out) on the page for ` +
              `skeletonKey "${task.skeletonKey}" at route "${task.url.pathname}".`,
          );
        }
        entries.push({
          skeletonKey: task.skeletonKey,
          widthBucket: task.widthBucket,
          direction: task.direction,
          snapshot: serialized,
        });
      } catch {
        failedKeys.add(task.skeletonKey);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  const capturedKeys = Array.from(new Set(entries.map((e) => e.skeletonKey))).filter(
    (key) => !failedKeys.has(key),
  );
  // `integrity` binds this manifest to the `bundle.css` written from it a few
  // lines below (`src/web/ssr/integrity.ts`). Computed AFTER the entry set is
  // final and stamped into the same object the CSS generator then hashes, so
  // the two artifacts can only ever leave this function agreeing.
  const manifestWithoutIntegrity: AutoSkeletonSSRManifest = {
    v: SSR_MANIFEST_VERSION,
    integrity: '',
    widthBuckets,
    capturedKeys,
    entries: entries.filter((e) => capturedKeys.includes(e.skeletonKey)),
  };
  const manifest: AutoSkeletonSSRManifest = {
    ...manifestWithoutIntegrity,
    integrity: computeSsrManifestIntegrity(manifestWithoutIntegrity),
  };

  if (failedKeys.size > 0) {
    throw new CaptureFailedError(Array.from(failedKeys), manifest);
  }

  const manifestPath = resolveOutputFile(options.outDir, MANIFEST_FILE_NAME);
  const cssBundlePath = resolveOutputFile(options.outDir, CSS_BUNDLE_FILE_NAME);
  await mkdir(options.outDir, { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  await writeFile(cssBundlePath, buildSsrCssBundle(manifest, { defaultRadius }), 'utf8');

  return {
    manifest,
    report: { capturedKeys, failedKeys: [], manifestPath, cssBundlePath },
  };
}

/** Thin CLI entrypoint: `node capture.js <registry.json> <baseURL> <outDir>`.
 *  The registry file is plain JSON (`{ "skeletonKey": "route", ... }`), read
 *  as data — never `eval`'d, never shell-interpreted. Exits non-zero (and
 *  names the failing skeletonKey(s) on stderr) when any capture fails,
 *  matching the threat matrix's "navigation timeout -> non-zero exit naming
 *  the offending skeletonKey" requirement. */
async function main(): Promise<void> {
  const [registryPath, baseURL, outDir] = process.argv.slice(2);
  if (!registryPath || !baseURL || !outDir) {
    console.error('Usage: autoskeleton-capture <registry.json> <baseURL> <outDir>');
    process.exitCode = 1;
    return;
  }
  const { readFile } = await import('node:fs/promises');
  const registry = JSON.parse(await readFile(registryPath, 'utf8')) as CaptureRegistry;
  try {
    const result = await runCapture({ baseURL, registry, outDir });
    console.log(
      `autoskeleton capture: ${result.report.capturedKeys.length} skeletonKey(s) captured -> ` +
        `${result.report.manifestPath}, ${result.report.cssBundlePath}`,
    );
  } catch (error) {
    if (error instanceof CaptureFailedError) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  }
}

// Only run as a CLI when invoked directly (the published `autoskeleton-capture`
// bin, which points at the bundled `dist-cli/capture.js`), never
// as a side effect of `import { runCapture } from './capture'` (tests and
// `<AutoSkeleton.SSR>`'s tooling import the named export only).
if (require.main === module) {
  void main();
}
