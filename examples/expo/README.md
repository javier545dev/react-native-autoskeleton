# autoskeleton — Expo example

An Expo app that installs `autoskeleton` from the packed tarball
(`file:../../.tarball/autoskeleton-0.1.0.tgz`), never a workspace symlink, and
covers what is **specific to Expo**:

- the core component resolved through `expo-modules-autolinking` rather than
  the RN CLI,
- the `autoskeleton/uniwind` theming interop (this is the app with `uniwind`
  and Tailwind v4 installed),
- the `expo-image` handoff,
- and **Expo Web**, via a separate entry.

Everything platform-neutral — lists, hints, ignore, delay, motion, tier-2 Skia
— lives in [`examples/bare-rn`](../bare-rn), which has the peers for it.

---

## Running it

```bash
npm install

npx expo prebuild            # required: this is a development build, not Expo Go
npm run ios                  # expo run:ios
npm run android              # expo run:android

npm run web                  # expo start --web
npm run export:web           # expo export --platform web
```

> **Expo Go will not work here, and that is expected.** `autoskeleton` ships a
> custom native Turbo Module, which is absent from the prebuilt Expo Go binary
> by design. A plain `expo start` pointed at Expo Go throws a named, actionable
> error in development.

If a library change does not appear, see
[`docs/development.md`](../../docs/development.md). Short version:

```bash
cd ../.. && npm run pack:tarball && npm run examples:unpin
cd examples/expo && npm install
npx expo start --clear
```

`npm run boot-smoke` only checks that `expo config` resolves with
`autoskeleton` in the dependency tree. It does not build.

---

## Two entries, and why

`App.tsx` is the **native** entry. `App.web.tsx` is the **web** entry, and it
imports none of `App.tsx`.

The reason is measured, not stylistic: `App.tsx` uses `ThemedAutoSkeleton` from
`autoskeleton/uniwind`, which imports the native `<AutoSkeleton>` and therefore
`react-native/Libraries/Utilities/codegenNativeComponent`. With `App.tsx` as
the only entry, `expo export --platform web` fails with:

```
Importing native-only module
"react-native/Libraries/Utilities/codegenNativeComponent" on web from:
node_modules/autoskeleton/lib/module/native/AutoskeletonOverlayNativeComponent.ts
```

Metro resolves `App.web.tsx` before `App.tsx` when `--platform web` is set, so
this split is the fix. **`autoskeleton/uniwind` is native-only** — see
[`docs/theming.md`](../../docs/theming.md).

That failure is loud and correct. The other Expo Web gap is not:

> **The virtualized-list API is native-only and its absence on web is a runtime
> `undefined`, never a compile error.** `expo/tsconfig.base.json` sets
> `customConditions: ['react-native']` with no platform variation, so this
> project's single `tsconfig.json` typechecks the whole app — including
> `App.web.tsx` — against the **native** declarations. Verified by running
> against this app on 2026-08-30: `tsc --noEmit -p tsconfig.json` over a file
> importing `{ SkeletonList, useSkeletonCell } from 'autoskeleton'` exits 0,
> and `expo export --platform web` bundles it into a plain property read that
> evaluates to `undefined`.
>
> If you copy this app's setup, guard list code with `Platform.OS !== 'web'` or
> put it in a `.native.tsx` file. See
> [`docs/platform-support.md` §3a](../../docs/platform-support.md).

`App.web.tsx` is also deliberately geometry-first: every box has explicit pixel
dimensions and every text run sits on a `lineHeight` far larger than its
`fontSize`, so `test/web/expo-web-export.spec.ts` can hit-test points that
**must** be covered by the skeleton (a glyph run, the avatar) and points that
**must not** be (the inter-line leading gap, the empty tail of a short line). A
sensor that collapsed the card into one container rect would pass a "does an
overlay exist" check and fail this one.

---

## What is on screen (native)

Two things, stacked, and they do not mix:

**1. `PaintGateStrip`** — the on-device theming fixture, mounted at the top and
never behind a menu entry. `npm run gate:uniwind` launches the app and polls
the **raw Android framebuffer** for three saturated registration colours
(`#ff00ff`, `#00ff00`, `#0000ff`), derives each target's centre from its frame's
bounding box, and asserts the painted shimmer pixels resolve from the
`className` values — at every phase of the shimmer, so a light phase cannot be
mistaken for a correct theme. It performs no navigation and cannot; putting the
fixture behind a menu would make it time out.

**2. `DemoGallery`** (`demos/registry.ts`) — three browsable demos:

| Demo | What it makes obvious |
| --- | --- |
| Theming with uniwind | One `className` drives the shimmer colours, checked against swatches carrying the same classes. |
| Image pipeline | Skeleton → `expo-image` blurhash → decoded image, and the handoff reason it really reports. |
| Basics under Expo | The same tarball, resolved by Expo autolinking instead of the RN CLI. |

### What the uniwind gate deliberately does not claim

**Only the colour half is gated.** The radius half is not, and the reason is
measured: the className-derived `defaultRadius` has no visible effect on
Android. The gate card (no `borderRadius` of its own) paints a **square** mask
despite `rounded-2xl`, while a card with its own `borderRadius: 16` paints a
rounded one.

The cause is Android's radius ladder, not the bridge (which has carried
`defaultRadius` since Phase 5): rung R1 answers *definitively* for a view with
no background drawable — `radius = 0, source = 'measured'` — so the
`defaultRadius` rung is never reached. Use `<AutoSkeleton.Hint radius>` on
Android. iOS is unaffected. Full detail in
[`docs/platform-support.md` §5d](../../docs/platform-support.md).

### What the image demo will report

On native, `onMetrics.handoffReason` reads `'timeout'` for every
`expectsPlaceholder` handoff, even when `expo-image` decoded instantly — the
automatic paint-detection heuristic is web-only. Worst case is a slightly
longer skeleton, never a flash. See
[`docs/image-pipeline.md` §4](../../docs/image-pipeline.md).

---

## Gated surface

- `test/web/expo-web-export.spec.ts` runs a real `expo export --platform web`
  of this app, serves the static output, and hit-tests the real `clip-path` in
  Chromium. It also proves Metro resolved the **web** entry (the CSS overlay
  renderer is present in the bundle text and no native codegen specifier is),
  and that the skeleton is a live loading state rather than a painted picture.
  It depends on the `testID`s in `App.web.tsx` (`card`, `avatar`, `title`,
  `subtitle`, `body`, `toggle`) and on its `skeletonOnRefresh` — without that
  prop the second load would be suppressed by the refresh policy and the
  handoff assertion would have nothing to observe.
- `npm run typecheck:docs-examples` compiles
  `docs-examples/ImagePipelineExample.tsx` — the worked example printed in
  [`docs/image-pipeline.md` §3](../../docs/image-pipeline.md) — against the
  real installed `autoskeleton` and `expo-image` types, so that snippet cannot
  drift from the real prop shape. It has already caught one doc bug this way (a
  `handoff` prop that does not exist).
- `npm run gate:uniwind` — the framebuffer theming gate described above.
