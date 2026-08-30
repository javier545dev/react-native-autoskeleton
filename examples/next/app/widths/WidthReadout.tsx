'use client';

// examples/next/app/widths/WidthReadout.tsx
//
// Reads the SSR overlay's RESOLVED geometry back out of the cascade, live,
// while you resize. The point is that these numbers change without a request,
// without a re-render of the overlay, and without anything measuring the page:
// the markup is a constant that the server sent once, and the browser is
// picking which `@media` block applies to it.
//
// `useSyncExternalStore` rather than an effect (the project's no-use-effect
// convention): the viewport and the computed style are external browser state,
// not derivable render state. The server snapshot is a distinct, honest
// "not measured yet" value — never a guess at the client's width, which is
// precisely the mistake this whole mechanism exists to avoid.

import { useSyncExternalStore } from 'react';
import { DemoReadout, DemoReadoutRow } from '../_demo/DemoShell';

interface Measurement {
  readonly viewportWidth: number;
  readonly boxWidth: string;
  readonly boxHeight: string;
  readonly clipPath: string;
}

const NOT_MEASURED: Measurement = {
  viewportWidth: 0,
  boxWidth: '—',
  boxHeight: '—',
  clipPath: '—',
};

// Module-scope so `getSnapshot` can return a STABLE reference. Building a
// fresh object per call would make React re-render forever.
let current: Measurement = NOT_MEASURED;
const listeners = new Set<() => void>();

function measure(): Measurement {
  const el = document.querySelector('[data-askl-ssr-key]');
  if (!el) {
    return { ...NOT_MEASURED, viewportWidth: window.innerWidth };
  }
  const style = getComputedStyle(el);
  return {
    viewportWidth: window.innerWidth,
    boxWidth: style.width,
    boxHeight: style.height,
    clipPath: style.clipPath,
  };
}

function refresh(notify: boolean): void {
  const next = measure();
  if (
    next.viewportWidth === current.viewportWidth &&
    next.boxWidth === current.boxWidth &&
    next.boxHeight === current.boxHeight &&
    next.clipPath === current.clipPath
  ) {
    return;
  }
  current = next;
  if (notify) {
    listeners.forEach((listener) => listener());
  }
}

function subscribe(onChange: () => void): () => void {
  const handler = () => refresh(true);
  listeners.add(onChange);
  window.addEventListener('resize', handler);
  // Seed WITHOUT notifying: React re-reads `getSnapshot` immediately after
  // subscribing, so a synchronous notify here would be a redundant render.
  refresh(false);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('resize', handler);
  };
}

/** `clip-path: path(...)` is a very long string. Show enough of it to see that
 *  it is real geometry and that it CHANGES with the bucket, without turning
 *  the readout into a wall of coordinates. */
function summarizeClipPath(clipPath: string): string {
  if (clipPath === 'none' || clipPath === '—') {
    return clipPath;
  }
  return clipPath.length > 72 ? `${clipPath.slice(0, 72)}… (${clipPath.length} chars)` : clipPath;
}

export function WidthReadout() {
  const measurement = useSyncExternalStore(
    subscribe,
    () => current,
    () => NOT_MEASURED,
  );

  return (
    <DemoReadout>
      <DemoReadoutRow
        label="window.innerWidth"
        value={measurement.viewportWidth === 0 ? '—' : `${measurement.viewportWidth}px`}
      />
      <DemoReadoutRow label="computed width" value={measurement.boxWidth} />
      <DemoReadoutRow label="computed height" value={measurement.boxHeight} />
      <DemoReadoutRow label="computed clip-path" value={summarizeClipPath(measurement.clipPath)} />
    </DemoReadout>
  );
}
