#!/usr/bin/env node
//
// tasks.md 7.2 (spec REQ-THEME-2) — ON-DEVICE paint gate for the
// `autoskeleton/uniwind` theming interop.
//
// ── What this proves, and what it deliberately refuses to prove ─────────────
//
// Task 7.2 established that `className` -> `shimmerBaseColor`/
// `shimmerHighlightColor` resolves correctly at the JS layer, with a logcat
// diagnostic and a human looking at a screenshot. Neither is a gate: the
// diagnostic proved a PROP was computed, and the screenshot was one frame,
// judged by eye, never re-run. Nothing automated has ever verified that a
// uniwind-driven theme reaches the PIXELS the device actually paints.
//
// This gate reads the raw Android framebuffer (`adb exec-out screencap`,
// RGBA_8888, lossless — never a re-encoded PNG, never a UI-automation snapshot
// of a view's declared properties) and asserts on painted colour.
//
// ── How it separates "the theme was applied" from "the shimmer happened to be
//    at a light phase" ───────────────────────────────────────────────────────
//
// The shimmer varies painted colour along exactly the axis this gate asserts
// on, so any single-frame colour check is satisfiable by accident. Three
// things are done about that, and none of them is "widen the tolerance":
//
//  1. THE RAMP IS MEASURED, NOT ASSUMED. The fixture paints two plain
//     uniwind-styled swatches carrying the same Tailwind classes the skeleton
//     names (`bg-slate-400`, `bg-cyan-300`). The gate reads those two painted
//     colours and uses them as the expected ramp endpoints. It never hard-codes
//     what a palette entry resolves to, so it cannot pass or fail for
//     Tailwind/uniwind palette reasons — only for theming reasons.
//
//  2. EVERY SAMPLE MUST LIE ON THAT RAMP. `AutoskeletonRendererTier1` paints a
//     `LinearGradient(base, highlight, base)` translated across the mask, so at
//     EVERY phase the painted colour is a point on the base->highlight segment.
//     "On the segment" is a property of the THEME and holds at every phase;
//     the library's default #e2e2e2 -> #f5f5f5 segment is nowhere near it. This
//     is the assertion a running shimmer cannot buy its way past.
//
//  3. BOTH ENDPOINTS MUST BE REACHED. Sampling walks the cycle (the sweep is
//     ~1400 ms, samples are ~300 ms apart with jitter, so phases are spread
//     across many periods) and requires the observed positions along the ramp
//     to reach BOTH ends: a near-pure base sample AND a near-pure highlight
//     sample. A gate that only ever saw one end would be exactly the
//     "tolerates variation along the axis the defect moves" mistake that let an
//     iOS renderer defect live through every gate in Phase 3.
//
// The device clock cannot be seeked the way `document.getAnimations()` lets the
// web gate seek Chromium, so phases here are covered by density rather than
// pinned. `--samples` is sized against the MEASURED phase distribution so that
// missing an endpoint is a ~3e-5 event rather than a coin flip; see
// MIN_ALPHA_REACH / MAX_ALPHA_REACH below.
//
// Usage:
//   node scripts/uniwind-paint-gate.mjs [--samples N] [--interval MS]
//                                       [--serial DEVICE] [--no-launch]
//
// Requires: the example app installed and runnable on a connected Android
// device/emulator (`npm run android`). The gate itself neither builds nor
// installs — it asserts about a running app, the same division of labour
// `PaintGate-UITests` has on iOS.
//
// Gotcha worth writing down, hit while building this gate: a DEBUG build gets
// its JS from Metro, and on a stock emulator React Native resolves the packager
// as `10.0.2.2:<port baked into the APK>` (`AndroidInfoHelpers`), so neither
// `adb reverse` nor `metro.host` can move it off port 8081 — `setprop` is
// denied on a production emulator image. To run this against a Metro on some
// other port (e.g. while another project owns 8081), write RN's own dev-server
// preference instead, which `run-as` permits for a debuggable app:
//
//   adb shell am force-stop <pkg>
//   printf '<?xml version="1.0" encoding="utf-8" standalone="yes" ?>\n<map>\n
//     <string name="debug_http_host">10.0.2.2:8083</string>\n</map>\n' \
//     | adb shell "run-as <pkg> sh -c 'cat > /data/data/<pkg>/shared_prefs/<pkg>_preferences.xml'"
//
// Delete that file to go back to the default. A release build needs none of
// this — it has no packager connection at all.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Registration-mark colours declared in `App.tsx`. Kept in sync by name, not
 *  by import: this file runs in plain Node with no bundler. */
const MARKS = {
  baseSwatch: { hex: '#ff00ff', rgb: [255, 0, 255], label: 'bg-slate-400 swatch (magenta mark)' },
  highlightSwatch: { hex: '#00ff00', rgb: [0, 255, 0], label: 'bg-cyan-300 swatch (green mark)' },
  skeleton: { hex: '#0000ff', rgb: [0, 0, 255], label: 'themed skeleton (blue mark)' },
};

/** `src/web/css-renderer.ts` DEFAULT_BASE_COLOR / DEFAULT_HIGHLIGHT_COLOR —
 *  the same two constants `native/AutoSkeleton.tsx`'s DEFAULT_THEME uses. What
 *  the skeleton paints when NO theming reaches it. */
const LIBRARY_DEFAULT_BASE = [226, 226, 226];
const LIBRARY_DEFAULT_HIGHLIGHT = [245, 245, 245];

/** How far a sample may sit OFF the measured base->highlight segment. Measured
 *  worst case on a real emulator run is 0.71, so this is ~8x the observed
 *  noise floor and still ~25x below the distance from the themed ramp to the
 *  library-default one. */
const RESIDUAL_TOLERANCE = 6;
/** A sample must come within this of the base end at least once. Free: the
 *  gradient is `CLAMP`ed, so the centre pixel sits at EXACTLY the base colour
 *  for a quarter of every sweep (measured: 5 of 20 samples were bit-identical
 *  to the swatch). */
const MIN_ALPHA_REACH = 0.06;
/** ...and this close to the highlight end at least once. The highlight peak
 *  crosses the sample point briefly rather than dwelling there, so this is a
 *  coverage threshold sized against the measured distribution: P(a given
 *  sample reaches 0.9) is 0.10, so with the default 100 samples the chance of
 *  missing it is ~3e-5. Raising it to 0.95 would halve that probability per
 *  sample and make the gate flaky (~1 run in 170) for no extra strength — the
 *  residual check above already rejects any colour that is not on the themed
 *  ramp at all. */
const MAX_ALPHA_REACH = 0.9;
/** Minimum separation required between the two measured ramp endpoints, and
 *  between each of them and the library default they replace. A degenerate or
 *  accidentally-default ramp makes every other assertion meaningless. */
const MIN_RAMP_SEPARATION = 40;
/** How far every sample must stay from the LIBRARY DEFAULT ramp, stated
 *  separately so the failure message can say which of the two things is wrong. */
const MIN_DEFAULT_RAMP_DISTANCE = 30;

function parseArgs(argv) {
  const args = { samples: 100, interval: 60, serial: undefined, launch: true, verbose: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--samples') args.samples = Number(argv[++i]);
    else if (arg === '--interval') args.interval = Number(argv[++i]);
    else if (arg === '--serial') args.serial = argv[++i];
    else if (arg === '--no-launch') args.launch = false;
    else if (arg === '--verbose') args.verbose = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function adb(args, options = {}) {
  const serial = options.serial ? ['-s', options.serial] : [];
  return execFileSync('adb', [...serial, ...args], {
    maxBuffer: 256 * 1024 * 1024,
    encoding: options.encoding ?? 'buffer',
  });
}

function androidPackageName() {
  const appJson = JSON.parse(readFileSync(path.join(APP_DIR, 'app.json'), 'utf8'));
  const name = appJson?.expo?.android?.package;
  if (!name) {
    throw new Error('examples/expo/app.json has no expo.android.package');
  }
  return name;
}

/** One raw framebuffer. `screencap` without `-p` emits a small header followed
 *  by uncompressed RGBA_8888 — no PNG round-trip, so a sampled pixel is
 *  byte-identical to what the compositor produced. The header is 12 bytes on
 *  older releases and 16 (an extra colour-space word) from Android 9 onward;
 *  which one is in play is derived from the payload length rather than assumed
 *  from an API level. */
function captureFrame(serial) {
  const buffer = adb(['exec-out', 'screencap'], { serial });
  const width = buffer.readUInt32LE(0);
  const height = buffer.readUInt32LE(4);
  const pixels = width * height * 4;
  let offset;
  if (buffer.length - 16 === pixels) offset = 16;
  else if (buffer.length - 12 === pixels) offset = 12;
  else {
    throw new Error(
      `unrecognised screencap payload: ${buffer.length} bytes for ${width}x${height} ` +
        `(expected ${pixels + 12} or ${pixels + 16})`,
    );
  }
  return { width, height, offset, buffer };
}

function pixelAt(frame, x, y) {
  const index = frame.offset + (y * frame.width + x) * 4;
  return [frame.buffer[index], frame.buffer[index + 1], frame.buffer[index + 2]];
}

/** Bounding box of every pixel exactly equal to `rgb`. Exact match is safe
 *  because the marks are opaque solid fills with no gradient, blur or opacity —
 *  and it is what keeps a fuzzy near-miss elsewhere on screen from silently
 *  widening the box. */
function findMark(frame, rgb) {
  const [r, g, b] = rgb;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;
  for (let y = 0; y < frame.height; y += 1) {
    let index = frame.offset + y * frame.width * 4;
    for (let x = 0; x < frame.width; x += 1, index += 4) {
      if (frame.buffer[index] === r && frame.buffer[index + 1] === g && frame.buffer[index + 2] === b) {
        count += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (count === 0) return null;
  return { minX, minY, maxX, maxY, count, centre: [Math.round((minX + maxX) / 2), Math.round((minY + maxY) / 2)] };
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Decomposes `observed` against the `base` -> `highlight` ramp: `alpha` is how
 *  far along it sits, `residual` is how far OFF it is. */
function decomposeOnRamp(observed, base, highlight) {
  const d = [highlight[0] - base[0], highlight[1] - base[1], highlight[2] - base[2]];
  const v = [observed[0] - base[0], observed[1] - base[1], observed[2] - base[2]];
  const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const alpha = (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / dd;
  const projected = [base[0] + alpha * d[0], base[1] + alpha * d[1], base[2] + alpha * d[2]];
  return { alpha, residual: distance(observed, projected) };
}

/** Shortest distance from `observed` to the SEGMENT (not the infinite line)
 *  between `a` and `b`. Used against the library-default ramp, where the
 *  question is "is this colour anywhere the untouched library could have
 *  painted", not "is it on that line somewhere far outside it". */
function distanceToSegment(observed, a, b) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [observed[0] - a[0], observed[1] - a[1], observed[2] - a[2]];
  const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const t = Math.min(1, Math.max(0, (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / dd));
  return distance(observed, [a[0] + t * d[0], a[1] + t * d[1], a[2] + t * d[2]]);
}

const rgbText = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const failures = [];

  const devices = adb(['devices'], { encoding: 'utf8' })
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.endsWith('\tdevice'))
    .map((line) => line.split('\t')[0]);
  if (devices.length === 0) {
    throw new Error('no Android device/emulator is connected (`adb devices` is empty)');
  }
  const serial = args.serial ?? devices[0];
  console.log(`device: ${serial}`);

  if (args.launch) {
    const pkg = androidPackageName();
    console.log(`launching ${pkg}`);
    adb(['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'], { serial });
  }

  // Poll until all three registration marks are on screen: the app may still be
  // starting, and the skeleton only exists once the sensor round-trip resolves.
  const deadline = Date.now() + 90_000;
  let frame;
  let marks;
  for (;;) {
    frame = captureFrame(serial);
    marks = Object.fromEntries(Object.entries(MARKS).map(([key, mark]) => [key, findMark(frame, mark.rgb)]));
    const missing = Object.entries(marks).filter(([, box]) => box === null);
    if (missing.length === 0) break;
    if (Date.now() > deadline) {
      throw new Error(
        `paint-gate fixture never appeared on screen; missing registration mark(s): ` +
          missing.map(([key]) => `${MARKS[key].label} ${MARKS[key].hex}`).join(', ') +
          `. Is the example app running and showing the home screen?`,
      );
    }
    sleep(500);
  }
  for (const [key, box] of Object.entries(marks)) {
    console.log(
      `mark ${MARKS[key].hex} (${MARKS[key].label}): ${box.count} px, ` +
        `bbox ${box.minX},${box.minY} -> ${box.maxX},${box.maxY}, centre ${box.centre.join(',')}`,
    );
  }

  // The gate must sample INSIDE the frames, so a mark whose bounding box is
  // implausibly large (a colour collision elsewhere on screen) is a hard error
  // rather than a silently wrong sample point.
  for (const [key, box] of Object.entries(marks)) {
    const w = box.maxX - box.minX;
    const h = box.maxY - box.minY;
    if (w > frame.width * 0.6 || h > frame.height * 0.4) {
      throw new Error(
        `registration mark ${MARKS[key].hex} matched a ${w}x${h} region — too large to be the fixture's ` +
          `frame; another element on screen is painting that exact colour`,
      );
    }
  }

  const samples = [];
  const baseRefs = [];
  const highlightRefs = [];
  const started = Date.now();
  for (let i = 0; i < args.samples; i += 1) {
    const shot = i === 0 ? frame : captureFrame(serial);
    baseRefs.push(pixelAt(shot, ...marks.baseSwatch.centre));
    highlightRefs.push(pixelAt(shot, ...marks.highlightSwatch.centre));
    samples.push(pixelAt(shot, ...marks.skeleton.centre));
    // Jitter so the sampling interval can never lock into a rational ratio with
    // the ~1400 ms sweep and alias onto a narrow band of phases.
    sleep(args.interval + Math.floor(Math.random() * args.interval));
  }
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  // ── The measured ramp endpoints. ──
  const rampBase = baseRefs[0];
  const rampHighlight = highlightRefs[0];
  console.log(`\nuniwind-resolved ramp, read from the painted swatches:`);
  console.log(`  bg-slate-400 -> ${rgbText(rampBase)}`);
  console.log(`  bg-cyan-300  -> ${rgbText(rampHighlight)}`);
  console.log(`skeleton samples: ${samples.length} over ${elapsed}s\n`);

  // The swatches are static; if they move, the sample points are wrong and
  // every conclusion below is void.
  for (const [label, series, reference] of [
    ['bg-slate-400 swatch', baseRefs, rampBase],
    ['bg-cyan-300 swatch', highlightRefs, rampHighlight],
  ]) {
    const drift = Math.max(...series.map((c) => distance(c, reference)));
    if (drift > 2) {
      failures.push(`${label} is not static across the run (max drift ${drift.toFixed(1)}) — sample point is wrong`);
    }
  }

  if (distance(rampBase, rampHighlight) < MIN_RAMP_SEPARATION) {
    failures.push(
      `the two uniwind swatches resolved to nearly the same colour ` +
        `(${rgbText(rampBase)} vs ${rgbText(rampHighlight)}) — the ramp is degenerate and proves nothing`,
    );
  }
  if (distance(rampBase, LIBRARY_DEFAULT_BASE) < MIN_RAMP_SEPARATION) {
    failures.push(`bg-slate-400 resolved to the library's own default base colour — the fixture proves nothing`);
  }
  if (distance(rampHighlight, LIBRARY_DEFAULT_HIGHLIGHT) < MIN_RAMP_SEPARATION) {
    failures.push(`bg-cyan-300 resolved to the library's own default highlight colour — the fixture proves nothing`);
  }

  // ── Every sample on the themed ramp, and off the default one. ──
  let minAlpha = Infinity;
  let maxAlpha = -Infinity;
  let worstResidual = 0;
  let offRamp = 0;
  let onDefaultRamp = 0;
  for (const [i, sample] of samples.entries()) {
    const { alpha, residual } = decomposeOnRamp(sample, rampBase, rampHighlight);
    minAlpha = Math.min(minAlpha, alpha);
    maxAlpha = Math.max(maxAlpha, alpha);
    worstResidual = Math.max(worstResidual, residual);
    if (residual > RESIDUAL_TOLERANCE) {
      offRamp += 1;
      if (offRamp <= 3) {
        failures.push(
          `sample ${i} painted ${rgbText(sample)}, which is ${residual.toFixed(1)} off the themed ramp ` +
            `${rgbText(rampBase)} -> ${rgbText(rampHighlight)} (tolerance ${RESIDUAL_TOLERANCE})`,
        );
      }
    }
    const defaultDistance = distanceToSegment(sample, LIBRARY_DEFAULT_BASE, LIBRARY_DEFAULT_HIGHLIGHT);
    if (defaultDistance < MIN_DEFAULT_RAMP_DISTANCE) {
      onDefaultRamp += 1;
      if (onDefaultRamp <= 3) {
        failures.push(
          `sample ${i} painted ${rgbText(sample)}, which is on the LIBRARY DEFAULT ramp ` +
            `(distance ${defaultDistance.toFixed(1)}) — no theming reached the pixels`,
        );
      }
    }
    if (args.verbose) {
      console.log(`  sample ${String(i).padStart(3)} ${rgbText(sample)} alpha=${alpha.toFixed(3)} residual=${residual.toFixed(1)}`);
    }
  }

  console.log(`ramp position observed: ${minAlpha.toFixed(3)} .. ${maxAlpha.toFixed(3)}`);
  console.log(`worst residual off the themed ramp: ${worstResidual.toFixed(2)} (tolerance ${RESIDUAL_TOLERANCE})`);
  console.log(`samples off the themed ramp: ${offRamp}; samples on the library-default ramp: ${onDefaultRamp}\n`);

  if (minAlpha > MIN_ALPHA_REACH) {
    failures.push(
      `the sweep never reached the BASE end of the themed ramp ` +
        `(closest ${minAlpha.toFixed(3)}, required <= ${MIN_ALPHA_REACH}) — only one endpoint was ever proven`,
    );
  }
  if (maxAlpha < MAX_ALPHA_REACH) {
    failures.push(
      `the sweep never reached the HIGHLIGHT end of the themed ramp ` +
        `(furthest ${maxAlpha.toFixed(3)}, required >= ${MAX_ALPHA_REACH}) — ` +
        `shimmerHighlightColor is not proven to come from the className`,
    );
  }

  if (failures.length > 0) {
    console.error('FAIL — uniwind paint gate\n');
    for (const failure of failures) console.error(`  * ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('PASS — the painted skeleton resolves BOTH ramp endpoints from uniwind className values.');
}

main().catch((error) => {
  console.error(`FAIL — uniwind paint gate: ${error.message}`);
  process.exitCode = 1;
});
