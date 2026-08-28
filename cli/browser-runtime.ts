// cli/browser-runtime.ts
//
// tasks.md 8.1: bundled (via `cli/bundle.ts`'s esbuild wrapper) into an IIFE
// and injected into the headless Chromium page via `page.addScriptTag`
// (mirrors `test/web/helpers/*-entry.ts`'s established pattern — this is the
// REAL production DOM sensor running inside a real browser, never a
// hand-rolled capture-time reimplementation). Exposes exactly the surface
// `cli/capture.ts`'s `page.evaluate` calls need: measure one root element and
// hand back a JSON-safe (`SerializedShapeSnapshot`) result.

import { composeCacheKey, quantizeFontScale } from '../src/core/cache-key';
import { serializeSnapshot } from '../src/core/snapshot-io';
import type { SerializedShapeSnapshot } from '../src/core/types';
import { createDomSensor, createEmptyHintRegistry } from '../src/web/dom-sensor';

export interface CaptureRootOptions {
  readonly skeletonKey: string;
  readonly widthBucket: number;
  readonly budgetMs: number;
  readonly maxShapes: number;
  readonly defaultRadius: number;
}

const sensor = createDomSensor();

/** Measures `selector`'s matched element with the real production DOM sensor
 *  and returns a JSON-safe snapshot, or `null` when the element is missing or
 *  not laid out yet (mirrors `Sensor.measure`'s own null contract). Reads the
 *  page's CURRENT `document.documentElement.dir` — the caller (`capture.ts`)
 *  sets it before injecting this script, so captured geometry always
 *  reflects the real, already-applied direction (never re-mirrored here). */
function captureRoot(selector: string, options: CaptureRootOptions): SerializedShapeSnapshot | null {
  const target = document.querySelector(selector);
  if (!(target instanceof HTMLElement)) {
    return null;
  }
  const direction = document.documentElement.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr';
  const key = composeCacheKey({
    skeletonKey: options.skeletonKey,
    viewportWidth: options.widthBucket,
    // fontScale is unknowable server-side (spec §1.8 residual limit) —
    // every captured entry is quantized to the neutral 1.0 scale so it only
    // ever hydrates a runtime cache hit for a user at the default scale.
    fontScale: quantizeFontScale(1),
    direction,
    platform: 'web',
  });
  const result = sensor.measure(target, {
    key,
    hints: createEmptyHintRegistry(),
    budgetMs: options.budgetMs,
    maxShapes: options.maxShapes,
    defaultRadius: options.defaultRadius,
    collectDebugSidecars: false,
  });
  if (result === null) {
    return null;
  }
  return serializeSnapshot(result.snapshot);
}

declare global {
  interface Window {
    __autoskeletonCapture__: {
      captureRoot: typeof captureRoot;
    };
  }
}

window.__autoskeletonCapture__ = { captureRoot };
