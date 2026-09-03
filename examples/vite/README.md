<img src="../../docs/assets/autoskeleton-logo.svg" alt="" width="64" height="64">

# autoskeleton — web demos (Vite)

A React SPA that installs `autoskeleton` the way a user does — from the packed
tarball (`file:../../.tarball/autoskeleton-0.1.0.tgz`), never a workspace
symlink into this repo's sources — and shows what the library actually does in
a browser.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build
npm run preview  # serves the production build
```

## How the app is laid out

Three levels, and nothing else:

1. **Identity band** — who this is and which renderer you are looking at. The
   `Web · Server · Native` switcher links to the other example apps on GitHub
   rather than to a localhost port, because no app here can assume another
   one's dev server is running; the local URLs are stated as text next to it.
2. **Grouped sidebar** — one entry per demo under a non-interactive group
   header. The active entry carries `aria-current="page"`, an accent leading
   bar and a tinted fill. Below 880px the sidebar is the same single list
   moved by CSS into a full-height overlay behind the band's **Demos** button
   — moved, not duplicated, so every `data-testid="nav-*"` still matches
   exactly one element.
3. **The demos themselves**, in a fixed anatomy: group kicker or header →
   title (a `#/<id>` self-link) → the one-sentence claim → a bordered **stage**
   labelled `Live` → controls → readout → note → the source file.

The stage border is the load-bearing part of that anatomy. The library paints
borderless, filled, grey, shimmering rectangles, so the app's own chrome is
never allowed to: every chrome surface here is text, a hairline-bordered
surface or a small accent element, and nothing outside a skeleton animates.
`src/styles/tokens.css` states that rule in full and holds every `--ui-*`
value that enforces it.

## The demos

One file per demo under `src/demos/`, one entry per file in
`src/demos/registry.ts`. The app renders **every** demo at `/`, grouped;
`#/<id>` focuses a single one. Each section shows its own source file verbatim
(imported with Vite's `?raw`, so the snippet cannot drift from the code that
just ran).

The registry array stays in the order the demos were written in; the page's
grouping comes from each entry's `group` field, so reordering the array would
change nothing on screen.

| Group | `#/<id>` | File | What it makes obvious |
| --- | --- | --- | --- |
| Start here | `cold-load` | `ColdLoad.tsx` | No skeleton was authored: the shapes come from a real traversal of the content's laid-out geometry. |
| Start here | `data-nullish` | `DataNullish.tsx` | Only nullish `data` means loading: the cart leaves the skeleton when its count becomes `0`. |
| Start here | `data-child` | `DataChildFunction.tsx` | `data={user}` + a function child replaces `isLoading={user === null}` + the inverted `{user !== null && …}` guard. |
| What gets detected | `text-lines` | `TextLines.tsx` | A wrapped paragraph gets one bar per line box, ragged last line included (`Range.getClientRects()`). |
| What gets detected | `hidden-content` | `HiddenContent.tsx` | `visibility: hidden` keeps its box and its rect, so it is easy to shape by accident. It is skipped: toggle the badge and the count drops by one. |
| What gets detected | `image-handoff` | `ImageHandoff.tsx` | `expectsPlaceholder`: the skeleton is removed only after the real image has painted. |
| Lifecycle | `cache-replay` | `CacheReplay.tsx` | Unmount and re-open: `cache HIT`, `0.00 ms` traversal, skeleton painted from the first frame. |
| Lifecycle | `refresh` | `RefreshPolicy.tsx` | REQ-PTR-1: by default a refresh over already-shown content keeps the content; `skeletonOnRefresh` opts out. |
| Lifecycle | `cold-fallback` | `ColdMissFallback.tsx` | Conditional children leave nothing to measure. Without `fallback` the wrapper is 0×0 and paints nothing, ever; with it, a box, a visible loading state and a measured `0 shapes`. |
| Lifecycle | `loading-wins` | `LoadingWins.tsx` | `isLoading` overrides `data`: same non-null value on both sides, only the panel passing `isFetching` runs a cycle. |
| Control & opt-out | `ignore` | `IgnoreSubtree.tsx` | `<AutoSkeleton.Ignore>` and the exported `IGNORE_ATTRIBUTE` remove a subtree from detection. |
| Control & opt-out | `hint` | `HintRadius.tsx` | `<AutoSkeleton.Hint radius>` overrides the measured corner radius — a typed prop, never a parsed className. |
| Theming & motion | `css-variables` | `CssVariableTheme.tsx` | `--skl-base` / `--skl-highlight` scoped through the cascade; three colours, zero props. |
| Theming & motion | `tailwind-theme` | `TailwindTheme.tsx` | The same contract through Tailwind v4 `@theme` tokens, dark mode as a pure class flip. |
| Theming & motion | `reduced-motion` | `ReducedMotion.tsx` | `prefers-reduced-motion: reduce` removes the travelling sweep and leaves the highlight breathing in place. |
| Diagnostics | `debug-overlay` | `DebugOverlayDemo.tsx` | Every detected shape outlined and labelled with its source. Dev builds only — compiled out of production. |

The group taxonomy is shared with `examples/next` and the two native
galleries, so the same six headings mean the same six things everywhere. This
app has no demo for `lists`, `server` or `tier2`; those live in the apps that
can actually show them.

Two things the demos deliberately do NOT claim, because they are not true
today:

- **`autoskeleton/uniwind` does not work on the web.** It reaches
  `codegenNativeComponent` and is native-only, so there is no uniwind demo
  here. See [`docs/theming.md`](../../docs/theming.md).
- **A `fallback` is not what you SEE on web right now.** It gives the wrapper
  a box — which is the difference between a loading state and 0 pixels — but a
  zero-shape snapshot makes `core/clip-path.ts` emit `path("")`, the browser
  rejects that as a `clip-path`, and the unclipped overlay paints its base fill
  over the whole wrapper. Measured in `cold-fallback`: `computed clip-path:
  none`, `background: rgb(226, 226, 226)`, box `296×111`. So the reader gets
  one flat block the size of your placeholder, with your placeholder behind it.
  Snapshots that have real shapes clip correctly (`cold-load`'s overlay carries
  a genuine `path("M 25 17 …")`), so this is specific to the empty-snapshot
  path `fallback` exists to cover.

## Things worth knowing while reading the code

- Metrics (`onMetrics`) fire once per COMPLETED loading cycle, so every readout
  appears after you resolve a demo, never while the skeleton is up. A cycle
  suppressed by REQ-PTR-1 reports nothing at all, by design.
- A wrapper that mounts with `isLoading` already `false` still settles one
  cycle right there, so its readout is populated before you press anything.
  `refresh`'s opted-in panel has always done this; `loading-wins` counts its
  cycles rather than reading the numbers, because two cycles of the same
  content are numerically identical.
- `onMetrics` is guarded on there being a snapshot, and `createDomSensor()`
  refuses to traverse a 0×0 wrapper. So a wrapper with conditional children and
  no `fallback` reports **nothing at all**, while the same wrapper WITH a
  fallback reports `0 shapes` — the fallback gives it a box, the traversal runs,
  and it finds nothing because the fallback itself is ignored. `cold-fallback`
  is the demo that shows both halves.
- `cacheHit` is decided once, when a wrapper first sees a cache key, and does
  not change for the life of that mounted component — which is why
  `cache-replay` unmounts instead of just toggling. Same for `traversalMs`.
- The reduced-motion preference is read when the overlay mounts and is **not**
  subscribed to on web. Change the setting, then remount. (Native *is*
  subscribed — see [`docs/animation.md` §2](../../docs/animation.md).)
- Reduce-motion and `animation="none"` are **not** the same result, and two
  places on this page say so: `ReducedMotion.tsx`'s own note, and the
  `reduced-motion` entry in `registry.ts`. Reduce-motion parks the highlight
  at the centre and breathes its opacity; `animation="none"` animates nothing
  at all. Commit `f464f11` is what made them differ — it moved the pulse onto
  the element that actually carries the highlight — and the registry sentence
  spent a while claiming the older behaviour. If you change one of those two
  strings, change the other in the same commit.

## Gated surface

`test/web/tailwind-app-theme.spec.ts` builds this app with its own
`npm run build`, serves `dist/` and samples PAINTED pixels at pinned shimmer
phases. It navigates to `/`, scrolls `[data-testid="themed-card"]` into view,
reads the single `.askl-overlay` inside `[data-testid="themed-demo"]`, clicks
`[data-testid="toggle-theme"]`, and asserts the built CSS still contains
`.rounded-xl` plus the `@theme` tokens from `src/tailwind-theme.css`.

What that gate makes non-negotiable in the chrome, beyond those selectors:

- `/` with no hash keeps rendering every demo, the theming one included.
- `.themed-card` keeps its 240×140 size and its `rounded-xl` class.
- Nothing sticky or translucent may sit over a stage. The identity band is
  static above 880px and `.demo` carries a `scroll-margin-top` taller than it
  is below that, so a `scrollIntoViewIfNeeded()` never parks a stage under
  the band.
- No chrome element animates. The gate pauses every `askl-shimmer` animation
  it finds and asserts on what it sampled; a decorative sweep in the chrome
  would be a second moving thing it never agreed to. On `/` the whole page
  reports exactly one animation name, `askl-shimmer`.

`examples/vite/scripts/capture-skeletons.ts` is a typecheck fixture for the
`autoskeleton/cli` programmatic API (`npm run typecheck:cli-consumer`), not part
of the app.
