# Troubleshooting

Symptom first. Every entry names the actual mechanism, not a guess, and links
to the page with the full story.

---

## The skeleton does not appear

### …on the second load, but the first one worked

**This is the default and it is intentional.** Once content has been shown,
`isLoading` going back to `true` keeps the content on screen instead of
covering it with a skeleton (REQ-PTR-1 — a pull-to-refresh should not blank out
what the reader is looking at).

```tsx
<AutoSkeleton isLoading={isLoading} skeletonKey="feed" skeletonOnRefresh>
```

Related: `onMetrics` does **not** fire for a suppressed cycle either, so a
missing metrics event on load #2 is the same cause, not a second bug.

### …at all, in Expo Go

Expo Go cannot load a custom native module. Use a development build
(`npx expo prebuild && npx expo run:ios|run:android`, or an EAS dev build).

In development you get a thrown `AutoskeletonNativeModuleUnavailableError`
naming this. In production it fails open — children render unwrapped and
`onMetrics.degraded` contains `'native-module-unavailable'`.

### …but the content is there and everything else works

Check `delay`. A `delay` of *N* ms withholds the skeleton until *N* ms into the
loading cycle, so a fast load never shows one. That is the point of the prop,
but a stale large value looks identical to "broken".

### …and the wrapper measured zero shapes

The sensor produces nothing for a subtree that has no laid-out geometry yet.
An empty measurement is treated as **provisional** for a bounded number of
attempts (paced by loading cycle, not by frame) precisely so an `<img>` with a
0×0 box is not cached forever as an empty skeleton. If it never resolves,
the subtree genuinely has no shapeable leaves.

On **web**, remember that `react-native-web`'s `<Image>` is a transparent box
until `ImageLoader` reports LOADED, so it contributes nothing to shape. Give it
a `backgroundColor` and its own box is shaped.

---

## `SkeletonList is not a function` / `undefined is not a function`

You imported a **native-only** API into a web bundle.

`SkeletonList`, `SkeletonListFooter`, `SkeletonCell`, `useSkeletonCell` and
`templateTraversalCounter` exist only on the native entry. In an Expo universal
app **TypeScript will not warn you**, because `expo/tsconfig.base.json` pins
`customConditions: ['react-native']` for the whole project.

Verified by running, 2026-08-30: `tsc --noEmit` over that import in
`examples/expo` exits 0, and `expo export --platform web` bundles it cleanly
into a plain property read that evaluates to `undefined`.

Guard it:

```tsx
{Platform.OS !== 'web' && <SkeletonList itemType="row" estimatedCount={6} />}
```

…or put the list code in a `.native.tsx` file.

## `Importing native-only module "…/codegenNativeComponent" on web`

You imported `autoskeleton/uniwind` into a web build. That subpath wraps the
native `<AutoSkeleton>` and is native-only. This failure is loud and correct.

Split your entry (`App.web.tsx` next to `App.tsx`, as `examples/expo` does), or
theme through CSS custom properties / Tailwind v4 `@theme` tokens on web. See
[`theming.md`](./theming.md).

---

## The debug overlay is blank

**`debugOverlay` only draws on web.** On iOS and Android the prop is accepted,
stored, and never read. Under the tier-2 Skia renderer it is not even
forwarded. This is our gap, not your configuration — see
[`platform-support.md` §5b](./platform-support.md).

On web, also confirm the build is not `production`: the overlay is
dead-code-eliminated by `process.env.NODE_ENV` replacement, which is why you do
not need to strip `debugOverlay` props before shipping.

---

## `<AutoSkeleton.Ignore>` does nothing (native)

Native `Ignore` works by `cloneElement`ing its child with a sentinel
`nativeID`/`testID`. **If the child is a composite component that does not
forward those props to a host element, the marker never reaches a native view
and the sensor has nothing to find — silently.**

```tsx
{/* Works: View is a host component */}
<AutoSkeleton.Ignore><View>…</View></AutoSkeleton.Ignore>

{/* Silently no-ops unless MyBadge spreads nativeID/testID onto a host view */}
<AutoSkeleton.Ignore><MyBadge /></AutoSkeleton.Ignore>
```

Two more constraints: it takes exactly **one** element child, and it
**overwrites** the child's `nativeID` and `testID`. If that child is one your
e2e suite matches on, move the `testID` to a wrapper it does not clone.

Web `Ignore` is a `display: contents` div and has none of these constraints.

## `<AutoSkeleton.Hint>` broke my `nativeID`

`Hint` always overwrites `nativeID` with its `id` — that is the Android lookup
channel. Your `testID` is preserved (the hint is additionally registered under
it so iOS still resolves), with a one-time `__DEV__` warning naming both. Use
the same string for `id` and `testID` to silence it.

---

## Corners are square on Android even though I set a radius

Android's radius ladder answers **definitively** at rung R1 for a view with no
background drawable: `radius = 0, source = 'measured'`. Most RN views have no
background, so `defaultRadius` (from `SkeletonProvider`, from the per-instance
prop, or from `autoskeleton/uniwind`'s `rounded-*` mapping) is never consulted
for them.

The mechanism that always works is the typed hint, which is rung R0:

```tsx
<AutoSkeleton.Hint id="avatar" radius={24}>
  <View style={{ width: 48, height: 48 }} />
</AutoSkeleton.Hint>
```

iOS reads `layer.cornerRadius` directly and is unaffected. Full detail in
[`platform-support.md` §5d](./platform-support.md).

You will also see a dev warning when more than 30% of a screen's shapes land on
the `default` rung — that warning is web-side (`radiusFallbackShare` is a web
`SkeletonProvider` prop) and driven by the `radiusSources` dev sidecar.

---

## A native paragraph renders as one block instead of lines

That is native's actual behaviour. Per-line text skeletons are a **web**
capability: the DOM sensor uses `Range.getClientRects()` and emits one bar per
laid-out line box.

On native, both sensors enter the line-synthesis branch only when
`frame.height < defaultLineHeight`, where `defaultLineHeight` is a compiled
constant of **20** that the bridge does not carry from JS. A normal multi-line
`<Text>` is taller than that, so it stays one rectangle — and the `lines` hint
does not fire for it either. See
[`platform-support.md` §5a](./platform-support.md).

---

## List skeleton rows are the wrong width (an avatar with nothing beside it)

The list template is measured off-screen inside an absolutely positioned
container with **no width of its own**, so it lays out at its intrinsic width
and any `flex: 1` / `width: '100%'` child collapses to zero.

Thread an explicit width through the template. Full explanation and a working
example in [`lists.md` §2](./lists.md).

## A list `itemType` never stops showing the generic fallback block

You did not supply `renderTemplate`. Without one there is nothing to traverse,
so that `itemType` renders `FallbackSkeletonBlock` forever — correctly, never a
crash, but never a measured shape either. Documented v1 limitation.

`useSkeletonCell().isFallback` tells you which path a cell is on.

---

## `onMetrics` numbers look wrong

Check the per-platform table in [`observability.md`](./observability.md) first.
The common surprises:

- **`traversalMs` is always `0` on iOS and Android.** It is hardcoded at the
  JS assembly site; native traversal timing is reported through
  `os_signpost`/`Trace` instead and never crosses the bridge.
- **`radiusSourceHistogram` is all zeros on native.** The dev sidecar is not
  requested and the wire has no slots for it.
- **`degraded` is always `[]` on native**, except `['native-module-unavailable']`.
  Native-side degradation flags exist but never cross the bridge.
- **`cacheHit` and `traversalMs` are latched once per mounted instance.** A
  second loading cycle in the same mounted component reports the first cycle's
  verdict. Unmount and remount to see a genuine cached serve.
- **`handoffReason` reads `'timeout'` on native with `expectsPlaceholder`.**
  The automatic paint-detection heuristic is web-only; on native every
  `expectsPlaceholder` handoff falls through to `handoffTimeoutMs` (default
  250 ms), even when your image loaded instantly.
- **No event at all for a refresh cycle** — see the REQ-PTR-1 entry at the top.

## `speedMs` was ignored and I got a console warning

There is one shared shimmer clock per JS context and **the first period to
reach a mounted skeleton wins**. A later request for a different `speedMs` is
refused, with a dev warning naming the ignored value, the value in effect, and
the two ways out (use one `speedMs` everywhere, or drop it). Identical on all
three platforms.

## Raising `handoffFadeMs` made the skeleton linger instead of fading

`handoffFadeMs` is a **removal delay**, not a fade. Nothing animates opacity on
teardown. Raising it keeps a fully opaque skeleton on screen for longer. The
name survived a cross-fade design that was never built.

---

## Tier-2 (Skia) does not draw / `onMetrics.renderer` says `'native'`

Installing `@shopify/react-native-skia` and `react-native-reanimated` is
deliberately **not enough**. Tier-2 is opt-in by an explicit act: you build the
overlay in your own module graph and hand it to the provider.

```tsx
const overlay = createSkiaOverlay({ skia: Skia, reanimated: { … } });
<SkeletonProvider overlay={overlay}>…</SkeletonProvider>
```

Reasons, both real: React Navigation requires Reanimated, so "installed"
says nothing about intent; and Metro's dependency graph is static, so a
conditional `require()` inside the library is rewritten into a function that
throws `Dynamic require … not supported by Metro`, which an earlier
auto-detection probe silently swallowed into "peer absent". That was observed
on a real device: an app with both peers installed, pods built and linked,
reported `renderer: 'native'`.

Also check that Reanimated's Babel plugin is **last** in `babel.config.js`.

## Tier-1 and tier-2 skeletons are out of phase with each other

Expected, and not fixable from your side. Both tiers share one shimmer
*period*; they do not share a phase *origin*. Tier-1 reads the native shimmer
clock's `startedAt`; tier-2 runs in JS and has no route to that value, so it
uses its own module-scope origin. Tier-2 instances are in phase with each
other, tier-1 instances with each other, and the two groups sit at an arbitrary
fixed offset. See [`platform-support.md` §5i](./platform-support.md).

Per-shape stagger is not implemented on either tier, despite
`staggerDelayForIndex` being exported and unit-tested.

---

## SSR: `<AutoSkeleton.SSR>` is not a component

There is no `AutoSkeleton.SSR`. The real names are `AutoSkeletonSSR` and
`AutoSkeletonSSRHydrate`, imported from `autoskeleton/ssr`, and
`AutoSkeletonSSR` requires a `manifest` prop:

```tsx
import { AutoSkeletonSSR } from 'autoskeleton/ssr';
import { manifest } from '../generated/autoskeleton-ssr';

<Suspense fallback={<AutoSkeletonSSR skeletonKey="dashboard" manifest={manifest} />}>
```

(Earlier revisions of these docs used the dotted form. It never existed.)

## SSR: every skeleton renders as a plain neutral block

Three causes, all of which say so in a dev build:

1. **The key was never captured.** Add it to the capture registry and re-run
   the CLI. A dev warning names every uncaptured key.
2. **Manifest/CSS drift.** `manifest.json` and `bundle.css` came from different
   capture runs; the CSS geometry rules stop selecting and the neutral block is
   shown instead of wrong geometry. Regenerate both together. Fail your build
   early with `assertSsrManifestIntegrity(manifest)`.
3. **Schema version mismatch.** The manifest was written by a different
   `autoskeleton` version. Re-run the capture — never hand-edit `v`.

See [`ssr-capture-cli.md`](./ssr-capture-cli.md).

## SSR: a reader with an enlarged browser font misses every captured entry

Intended. The font scale is part of the cache key, and the capture CLI writes
the neutral `1` because the preference is unknowable server-side. A miss yields
geometry measured for *that* reader; a hit would have yielded geometry measured
for somebody else.

---

## Types resolve to the wrong platform

`autoskeleton` publishes **different declaration files per platform condition**.
For TypeScript to honour them at all your `tsconfig.json` needs
`"moduleResolution": "bundler"` or `"node16"`/`"nodenext"` — classic `"node"`
resolution ignores `package.json#exports` entirely.

- **React Native**: needs `"customConditions": ["react-native"]`, which
  `@react-native/typescript-config` and `expo/tsconfig.base` both already set.
- **Web bundlers**: nothing to configure; `default` already resolves to the web
  surface, and `SkeletonList` correctly does not resolve there.

### Jest resolves to the web build in a React Native test

Jest's resolver does not apply `exports` conditions at all — independent of
`moduleResolution`. Add:

```js
module.exports = {
  preset: '@react-native/jest-preset',
  testEnvironmentOptions: { customExportConditions: ['react-native'] },
};
```

See `examples/bare-rn/jest.config.js`.

---

## Working on this repo: my library change does not show up in an example app

This one costs real time, so it gets the full account. Three caches stack, and
the first one fails **silently**.

### 1. npm will not re-extract a repacked tarball at the same path

The example apps install `autoskeleton` from
`file:../../.tarball/autoskeleton-0.1.0.tgz`. The path and the version never
change, so npm considers the dependency already satisfied — and the lockfile
pins an integrity hash whose matching bytes are already in the npm content
cache.

**Verified by running, 2026-08-30**, in an isolated scratch project:

| Step | Result |
|---|---|
| Repack the tarball with genuinely different bytes, then `npm install` | `up to date, audited 3 packages`, **exit 0**, old bytes still installed |
| `npm install --force` | `up to date`, **exit 0**, still old bytes |
| `rm -rf node_modules/autoskeleton && npm install` | `added 1 package`, **exit 0**, **still old bytes** (re-hydrated from the npm cache by the pinned hash) |
| Drop the lockfile `integrity` for the local `file:` tarball, then `npm install` | `changed 1 package`, **fresh bytes installed** |

Deleting `node_modules` is not enough. The lockfile pin is the load-bearing
part, and this repository ships the fix:

```bash
npm run pack:tarball                       # repack (runs prepare -> bob build)
npm run examples:unpin                     # drop the file: tarball pin in every examples/*/package-lock.json
cd examples/vite && npm install            # now installs the bytes you just packed
```

`scripts/unpin-local-tarball.mjs` touches **only** entries whose `resolved` is a
local `file:` `.tgz`. Every registry dependency keeps its real pin. Pass
directories to limit it: `node scripts/unpin-local-tarball.mjs examples/next`.

Why unpinning is correct here rather than a weakening: an `integrity` hash
exists to pin an artifact you do not control. This tarball is this repository's
own `npm pack` output from the working tree the lockfile lives in — the hash
guarantees nothing about provenance and instead asserts "the library will
re-pack to exactly these bytes", which every source edit falsifies. The stale
pin is also what made `docs.yml` die with `EINTEGRITY` on a runner whose own
tarball was byte-for-byte correct.

### 2. Metro keeps its own module cache

```bash
npx react-native start --reset-cache      # bare RN
npx expo start --clear                    # Expo
```

### 3. Vite keeps a dependency pre-bundle

```bash
rm -rf examples/vite/node_modules/.vite
# or: npx vite --force
```

If a change still does not appear after all three, check that it is actually in
the packed artifact: `tar -tzf .tarball/autoskeleton-0.1.0.tgz | grep <file>`,
and remember that `package.json#files` excludes `**/*.test.*`, `__tests__`,
`__mocks__`, `__fixtures__` and dotfiles.

---

## Dev warnings you may see, and what each means

| Warning starts with | Meaning |
|---|---|
| `[autoskeleton] traversal took Nms, exceeding…` | Over `budgetMs` (default 2 ms). Reduce subtree depth or `<AutoSkeleton.Ignore>` expensive branches. |
| `[autoskeleton] detected N shapes, exceeding…` | Over `maxShapes` (default 60). Ignore decorative subtrees or raise `maxShapes`. |
| `[autoskeleton] N/M shapes (X%) resolved their corner radius through the 'default' fallback rung…` | Over `radiusFallbackShare` (default 30%). Add typed `radius` hints. |
| `[autoskeleton] <AutoSkeleton.Hint id="…"> wraps a … that already sets testID="…"` | Your `testID` was kept; the hint was aliased under it. Use one string for both to silence. |
| A refused `speedMs` value | Two themes asked for two shimmer periods; the first mounted one won. |
| An SSR schema-version or manifest/CSS-drift warning | See the SSR section above. |

All of these are gated to non-production builds.
