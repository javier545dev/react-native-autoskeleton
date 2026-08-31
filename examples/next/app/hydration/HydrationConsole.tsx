'use client';

// examples/next/app/hydration/HydrationConsole.tsx
//
// Records what React says on the way in.
//
// "Zero hydration mismatch" is an absence, and an absence is the easiest thing
// in the world to demonstrate dishonestly — a page that simply never checks
// looks identical to a page that checks and finds nothing. So this records
// React's own console output starting BEFORE hydration, and the route ships a
// deliberately broken control (`?mismatch=1`) that makes the same recorder
// fill up. A detector that has never fired is not evidence.
//
// The patch runs at MODULE scope, not in a component: client component chunks
// are evaluated before `hydrateRoot` runs, so this is installed in time to
// catch the first message. The log lives at module scope for the same reason —
// a hydration failure makes React discard and re-render the tree, which would
// wipe the record if it were held in component state.
//
// Two channels, because React uses two. A DEVELOPMENT build prints the full
// hydration diff through `console.error`. A PRODUCTION build — which is what
// `next build && next start` gives you, and what this was verified against —
// throws the minified form instead, so it arrives as an uncaught `error`
// event carrying "Minified React error #418" and a react.dev link, and never
// touches the console at all. Listening to only one of the two would have made
// this page report a clean bill of health for a document that genuinely
// mismatched, which is the exact failure mode it exists to rule out.
// 418/423/425 are the hydration family.

import { useSyncExternalStore } from 'react';
import { DemoReadout, DemoReadoutRow } from '../_demo/ui';

export interface ConsoleRecord {
  readonly level: 'console.error' | 'console.warn' | 'uncaught';
  readonly text: string;
  readonly hydration: boolean;
}

let records: readonly ConsoleRecord[] = [];
const listeners = new Set<() => void>();
let installed = false;

const HYDRATION_PATTERN = /hydrat|did not match|react\.dev\/errors\/(418|423|425)|Minified React error #(418|423|425)/i;

function record(level: ConsoleRecord['level'], args: readonly unknown[]): void {
  const text = args
    .map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}` : String(arg)))
    .join(' ');
  records = [...records, { level, text, hydration: HYDRATION_PATTERN.test(text) }];
  listeners.forEach((listener) => listener());
}

function install(): void {
  if (installed || typeof window === 'undefined') {
    return;
  }
  installed = true;
  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);
  console.error = (...args: unknown[]) => {
    record('console.error', args);
    originalError(...args);
  };
  console.warn = (...args: unknown[]) => {
    record('console.warn', args);
    originalWarn(...args);
  };
  // The production channel. React rethrows a minified hydration failure, so
  // it arrives here and nowhere else.
  window.addEventListener('error', (event) => {
    record('uncaught', [event.error ?? event.message]);
  });
}

install();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

const SERVER_SNAPSHOT: readonly ConsoleRecord[] = [];

export function HydrationConsole() {
  const entries = useSyncExternalStore(
    subscribe,
    () => records,
    () => SERVER_SNAPSHOT,
  );
  const hydrationEntries = entries.filter((entry) => entry.hydration);

  return (
    <div data-testid="hydration-console">
      <DemoReadout>
        <DemoReadoutRow
          label="hydration failures"
          value={<span data-testid="hydration-count">{hydrationEntries.length}</span>}
        />
        <DemoReadoutRow label="all recorded messages" value={String(entries.length)} />
      </DemoReadout>

      {entries.length === 0 ? (
        <p className="ui-note">
          React has said nothing, on either channel, while a real server-rendered skeleton was on screen and
          hydrating.
        </p>
      ) : (
        <ul className="mt-3 space-y-2 font-mono text-xs leading-5">
          {entries.map((entry, index) => (
            <li
              key={`${index}-${entry.text.slice(0, 32)}`}
              className={
                entry.hydration
                  ? 'rounded border border-ui-danger/40 bg-ui-danger/10 p-3'
                  : 'rounded border border-ui-line p-3'
              }
            >
              <span className="text-ui-ink-3">
                {entry.level}
                {entry.hydration ? ' · hydration' : ''} ·{' '}
              </span>
              {entry.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
