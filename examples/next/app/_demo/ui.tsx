// examples/next/app/_demo/ui.tsx
//
// The demo anatomy's shared pieces: the bordered stage and the monospace
// readout. They live apart from `DemoShell.tsx` for one concrete reason —
// four of the demos' readouts are `'use client'` components
// (`widths/WidthReadout`, `drift/DriftTokens`, `hydration/HydrationConsole`,
// `client-cache/ClientCachePanel`), and `DemoShell.tsx` reads the route's own
// source off disk with `node:fs/promises`. A client component importing that
// module would drag a Node builtin into the browser bundle. These components
// have no such dependency, so they are safe on both sides of the boundary.
//
// `_demo` is an App Router PRIVATE folder: the leading underscore keeps it out
// of routing, so neither this module nor `DemoShell.tsx` can accidentally
// become a page.

import type { ReactNode } from 'react';

/** A labelled stage for one specimen, so two of them side by side are
 *  unambiguous about which is which — and so a border always says where the
 *  app stops and the library's output starts. `live` names the API under
 *  demonstration, which is what makes a screenshot of one stage
 *  self-explanatory. */
export function DemoStage({
  label,
  note,
  live,
  children,
}: {
  label: string;
  note?: string;
  live?: string;
  children: ReactNode;
}) {
  return (
    <section className="ui-stage">
      <div className="ui-stage-head">
        <h2 className="ui-stage-label">{label}</h2>
        {live ? <span className="ui-stage-live">{live}</span> : null}
      </div>
      {note ? <p className="ui-stage-note">{note}</p> : null}
      <div className="ui-stage-body">{children}</div>
    </section>
  );
}

/** The monospace readout every demo uses for values it measured rather than
 *  values it asserts. */
export function DemoReadout({ children }: { children: ReactNode }) {
  return <dl className="ui-readout">{children}</dl>;
}

export function DemoReadoutRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
