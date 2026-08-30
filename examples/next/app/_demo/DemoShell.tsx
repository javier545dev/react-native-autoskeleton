// examples/next/app/_demo/DemoShell.tsx
//
// The frame every SSR demo route renders inside: the heading and the one
// sentence from `registry.ts`, the "how to look at it" list, a link back to
// the index, and the honest `?delay=` control where the demo has one.
//
// A plain server component with no hooks and no client boundary. That is not
// an optimisation — a demo page about server rendering that quietly turned
// itself into a client tree would be demonstrating the opposite of its
// subject.

import type { ReactNode } from 'react';
import { demoFor } from './registry';

export function DemoShell({ href, children }: { href: string; children: ReactNode }) {
  const demo = demoFor(href);
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <p className="text-sm">
        {/* A full page load, not a `next/link` client navigation: every route
            here is about the document the SERVER sent, and arriving via the
            client router would mean arriving after React is already running,
            with nothing left to look at. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="underline underline-offset-4">
          ← All SSR demos
        </a>
      </p>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">{demo.title}</h1>
      <p className="mt-1 font-mono text-sm text-zinc-500">{demo.href}</p>
      <p className="mt-4 text-base leading-7 text-zinc-600 dark:text-zinc-400">{demo.shows}</p>
      <ul className="mt-4 list-disc space-y-1 pl-5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        {demo.check.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {demo.control ? (
        <p className="mt-4 text-sm">
          <a href={demo.control.href} className="underline underline-offset-4">
            {demo.control.label} → <code className="font-mono">{demo.control.href}</code>
          </a>
        </p>
      ) : null}
      <div className="mt-10 border-t border-black/[.08] pt-8 dark:border-white/[.145]">{children}</div>
    </div>
  );
}

/** A labelled stage for one specimen, so two of them side by side are
 *  unambiguous about which is which. */
export function DemoStage({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-8 first:mt-0">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">{label}</h2>
      {note ? <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{note}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** The monospace readout every demo uses for values it measured rather than
 *  values it asserts. */
export function DemoReadout({ children }: { children: ReactNode }) {
  return (
    <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 rounded-lg bg-black/[.04] p-4 font-mono text-xs leading-6 dark:bg-white/[.06] sm:grid-cols-[max-content_1fr]">
      {children}
    </dl>
  );
}

export function DemoReadoutRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="break-all">{value}</dd>
    </>
  );
}
