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

## The demos

One file per demo under `src/demos/`, one entry per file in
`src/demos/registry.ts`. The app renders every demo at `/`; `#/<id>` focuses a
single one. Each section shows its own source file verbatim (imported with
Vite's `?raw`, so the snippet cannot drift from the code that just ran).

| `#/<id>` | File | What it makes obvious |
| --- | --- | --- |
| `cold-load` | `ColdLoad.tsx` | No skeleton was authored: the shapes come from a real traversal of the content's laid-out geometry. |
| `text-lines` | `TextLines.tsx` | A wrapped paragraph gets one bar per line box, ragged last line included (`Range.getClientRects()`). |
| `cache-replay` | `CacheReplay.tsx` | Unmount and re-open: `cache HIT`, `0.00 ms` traversal, skeleton painted from the first frame. |
| `image-handoff` | `ImageHandoff.tsx` | `expectsPlaceholder`: the skeleton is removed only after the real image has painted. |
| `ignore` | `IgnoreSubtree.tsx` | `<AutoSkeleton.Ignore>` and the exported `IGNORE_ATTRIBUTE` remove a subtree from detection. |
| `hint` | `HintRadius.tsx` | `<AutoSkeleton.Hint radius>` overrides the measured corner radius — a typed prop, never a parsed className. |
| `css-variables` | `CssVariableTheme.tsx` | `--skl-base` / `--skl-highlight` scoped through the cascade; three colours, zero props. |
| `tailwind-theme` | `TailwindTheme.tsx` | The same contract through Tailwind v4 `@theme` tokens, dark mode as a pure class flip. |
| `refresh` | `RefreshPolicy.tsx` | REQ-PTR-1: by default a refresh over already-shown content keeps the content; `skeletonOnRefresh` opts out. |
| `reduced-motion` | `ReducedMotion.tsx` | `prefers-reduced-motion: reduce` stops the sweep, the same still result `animation="none"` gives deliberately. |
| `debug-overlay` | `DebugOverlayDemo.tsx` | Every detected shape outlined and labelled with its source. Dev builds only — compiled out of production. |

Two things the demos deliberately do NOT claim, because they are not true today:

- **`autoskeleton/uniwind` does not work on the web.** It reaches
  `codegenNativeComponent` and is native-only, so there is no uniwind demo
  here.
- **Reduced motion degrades to a still block, not to a pulse.** The pulse
  keyframes animate `.askl-overlay-base`, which has no background of its own
  (the base colour lives on `.askl-overlay`), so nothing visibly pulses. The
  demo says "still", which is what a browser actually shows.

## Things worth knowing while reading the code

- Metrics (`onMetrics`) fire once per COMPLETED loading cycle, so every readout
  appears after you resolve a demo, never while the skeleton is up. A cycle
  suppressed by REQ-PTR-1 reports nothing at all, by design.
- `cacheHit` is decided once, when a wrapper first sees a cache key, and does
  not change for the life of that mounted component — which is why
  `cache-replay` unmounts instead of just toggling.
- The reduced-motion preference is read when the overlay mounts. Change the
  setting, then remount.

## Gated surface

`test/web/tailwind-app-theme.spec.ts` builds this app with its own
`npm run build`, serves `dist/` and samples PAINTED pixels at pinned shimmer
phases. It navigates to `/`, scrolls `[data-testid="themed-card"]` into view,
reads the single `.askl-overlay` inside `[data-testid="themed-demo"]`, clicks
`[data-testid="toggle-theme"]`, and asserts the built CSS still contains
`.rounded-xl` plus the `@theme` tokens from `src/tailwind-theme.css`. Keep those
selectors, that class and the "all demos render at `/`" behaviour intact.

`examples/vite/scripts/capture-skeletons.ts` is a typecheck fixture for the
`autoskeleton/cli` programmatic API (`npm run typecheck:cli-consumer`), not part
of the app.
