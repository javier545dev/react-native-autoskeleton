// test/web/helpers/dom-sensor-entry.ts
//
// esbuild entry for test/web/dom-sensor.spec.ts (task 2.1). Attaches the
// REAL production `createDomSensor` (and the small amount of core surface a
// test needs to build `SensorOptions`) to `window.Autoskeleton` so Playwright
// tests can drive it via `page.evaluate` (plan.md §7.3).

import { createDomSensor, createEmptyHintRegistry, IGNORE_ATTRIBUTE } from '../../../src/web/dom-sensor';
import { composeCacheKey } from '../../../src/core/cache-key';
import { decodeWire } from '../../../src/core/wire';

window.Autoskeleton = {
  createDomSensor,
  createEmptyHintRegistry,
  IGNORE_ATTRIBUTE,
  composeCacheKey,
  decodeWire,
};
