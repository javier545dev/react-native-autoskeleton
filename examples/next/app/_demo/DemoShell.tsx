// examples/next/app/_demo/DemoShell.tsx
//
// The frame every SSR demo route renders inside: the identity band, the
// grouped navigation, and the demo anatomy — kicker, title, claim, the "how to
// look at it" list, the honest `?delay=` control where the demo has one, the
// stages the route itself supplies, and the route's own source.
//
// A plain server component with no hooks and no client boundary. That is not
// an optimisation — a demo page about server rendering that quietly turned
// itself into a client tree would be demonstrating the opposite of its
// subject. It is also why the shell lives HERE rather than in a layout: the
// four routes `test/ssr/dashboard.spec.ts` drives (/dashboard, /dashboard-rtl,
// /uncaptured and the capture route /dashboard-capture) do not import this
// file, so they stay bare specimens with no chrome around the thing being
// measured, and nothing added here can reach them.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReactNode } from 'react';
import { demoFor, groupedDemos, groupFor } from './registry';

// Every internal link in this file is a plain `<a>` rather than a
// `next/link` client navigation: every route here is about the document the
// SERVER sent, and arriving via the client router would mean arriving after
// React is already running, with nothing left to look at. The rule below
// would flag these as accidental; here they are the point.

const REPO = 'https://github.com/javier545dev/react-native-autoskeleton/tree/main/examples';

/** The other renderers of the same library. Neither app can assume the other's
 *  dev server is running, so the cross-links go to the folder on GitHub and
 *  the local URL is stated as text instead of linked. */
const RENDERERS = [
  { label: 'Web', href: `${REPO}/vite`, current: false },
  { label: 'Server', href: `${REPO}/next`, current: true },
  { label: 'Native', href: `${REPO}/bare-rn`, current: false },
] as const;

/** The grouped list of demos, in the shared taxonomy's fixed order. Rendered
 *  twice — once in the sidebar and once inside the narrow-width disclosure —
 *  because making one copy serve both would need either JavaScript to move it
 *  or a `<details>` whose content is force-shown at desktop width, and browsers
 *  do not agree on how to override that. Two copies of a list of nine links is
 *  the cheaper honesty. */
function DemoNav({ activeHref, idPrefix }: { activeHref?: string; idPrefix: string }) {
  return (
    <>
      {groupedDemos().map(({ group, demos }) => (
        <div key={group.id} className="ui-nav-group">
          <h2 className="ui-nav-group-title" id={`${idPrefix}-${group.id}`}>
            {group.title}
          </h2>
          <ul className="ui-nav-list" aria-labelledby={`${idPrefix}-${group.id}`}>
            {demos.map((demo) => (
              <li key={demo.href}>
                <a
                  href={demo.href}
                  className="ui-nav-link"
                  aria-current={demo.href === activeHref ? 'page' : undefined}
                >
                  {demo.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

/** The identity band: who this is, which renderer you are looking at, and —
 *  below 880px, where the sidebar is gone — the disclosure that carries the
 *  same grouped list. The disclosure is a bare `<details>`: this app ships no
 *  client component for navigation, so open/closed has to be a state the
 *  browser owns and the stylesheet can see. */
export function IdentityBand({ activeHref }: { activeHref?: string }) {
  return (
    <header className="ui-band">
      <div className="ui-band-inner">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="ui-brand">
          {/* A plain `<img>` on two counts. First, the file declares about
              twenty gradient, clip and filter `id`s in its own `<defs>`;
              inlined, those would land in the DOCUMENT's global id namespace,
              and this band renders on every shelled route while `DemoNav`
              below is already rendered twice per page — the one namespace in
              here that must not gain duplicate entries. An `<img>` keeps them
              sealed inside the resource. Second, `next/image` would need
              `dangerouslyAllowSVG` on the optimiser (or `unoptimized`) to pass
              a vector through, and buys nothing for a 7 KB file drawn at one
              fixed size, so the rule below is disabled deliberately rather
              than worked around.

              `width`/`height` are explicit so the box is reserved before the
              file loads: below 880px this band is sticky, and a mark that
              grew it after paint would move every anchor under it. Measured on
              the production build, the mark takes the band from 48.39px to
              53.00px at desktop width and from 52.39px to 53.00px below 880px,
              where the disclosure summary was already the tallest thing in the
              row. Nothing in this app is sized against that number — the four
              routes `test/ssr/dashboard.spec.ts` measures never render this
              band at all — and 53px sits closer to the vite band's 57px than
              48px did, which is the direction the shared design wants. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="ui-brand-logo"
            src="/autoskeleton-logo.svg"
            alt=""
            width={28}
            height={28}
            decoding="async"
          />
          <span className="ui-brand-text">
            <span className="ui-brand-name">autoskeleton</span>
            <span className="ui-brand-role">SSR demos</span>
          </span>
        </a>

        <details className="ui-disclosure">
          <summary aria-label="Show the demo index">Demos</summary>
          <nav className="ui-disclosure-panel" aria-label="Demos">
            <DemoNav activeHref={activeHref} idPrefix="compact-nav" />
          </nav>
        </details>

        <nav className="ui-switcher" aria-label="Renderer">
          {RENDERERS.map((renderer) =>
            renderer.current ? (
              <span key={renderer.label} className="ui-switch" aria-current="true">
                {renderer.label}
              </span>
            ) : (
              <a key={renderer.label} className="ui-switch" href={renderer.href}>
                {renderer.label}
              </a>
            ),
          )}
          <span className="ui-switch-note">localhost:3000</span>
        </nav>
      </div>
    </header>
  );
}

export function DemoShell({ href, children }: { href: string; children: ReactNode }) {
  const demo = demoFor(href);
  const group = groupFor(demo);

  return (
    <div className="ui-shell">
      <IdentityBand activeHref={href} />

      <div className="ui-body">
        <nav className="ui-sidebar" aria-label="Demos">
          <DemoNav activeHref={href} idPrefix="nav" />
        </nav>

        <main className="ui-main">
          <article className="ui-page">
            <p className="ui-kicker">{group.title}</p>
            <h1 className="ui-title">{demo.title}</h1>
            <p className="ui-path">{demo.href}</p>
            <p className="ui-claim">{demo.shows}</p>

            <ul className="ui-check">
              {demo.check.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>

            {demo.control ? (
              <p>
                <a href={demo.control.href} className="ui-control">
                  {demo.control.label}
                  <span className="ui-control-hint">{demo.control.href}</span>
                </a>
              </p>
            ) : null}

            {children}

            <DemoSource href={demo.href} />
          </article>
        </main>
      </div>
    </div>
  );
}

/** The route's own `page.tsx`, read off disk at render time rather than
 *  duplicated into a string constant — a transcribed snippet is a second copy
 *  free to drift from the file it claims to show, which is the same failure
 *  `registry.ts` exists to prevent for prose.
 *
 *  Every route that renders this is `force-dynamic`, so the read happens per
 *  request with `process.cwd()` at the app root, never at build time. If it
 *  fails for any reason — a trimmed deployment, a moved file — the pointer to
 *  the path is still shown, because a missing convenience must not take a page
 *  down with it. */
async function DemoSource({ href }: { href: string }) {
  const relativePath = `app${href}/page.tsx`;
  let source: string | null = null;
  try {
    source = await readFile(path.join(process.cwd(), 'app', href.slice(1), 'page.tsx'), 'utf8');
  } catch {
    source = null;
  }

  if (source === null) {
    return (
      <p className="ui-note">
        Source: <code className="font-mono">{relativePath}</code>
      </p>
    );
  }

  return (
    <details className="ui-source">
      <summary>
        <span>{relativePath}</span>
        <span aria-hidden="true">source ▾</span>
      </summary>
      <pre>
        <code>{source}</code>
      </pre>
    </details>
  );
}
