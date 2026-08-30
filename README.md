# autoskeleton

Automatic skeleton loaders for React Native and web. One sensor reads your
existing layout and paints a skeleton over the geometry it actually measured —
no hand-authored placeholder shapes, and no second component tree to keep in
sync with the real one.

```tsx
import { AutoSkeleton } from 'autoskeleton';

function ProductCard({ product }: { product: Product | null }) {
  return (
    <AutoSkeleton isLoading={product === null} skeletonKey="product-card">
      {product !== null && <ProductContent product={product} />}
    </AutoSkeleton>
  );
}
```

That is the whole simple case. `autoskeleton` measures the real
`ProductContent` the first time it renders, caches the result under
`skeletonKey`, and replays a skeleton over the identical geometry on every
later loading state — including on a fresh mount, before `ProductContent`
exists at all.

---

## Is this for you?

**Yes if** you are on React Native's New Architecture (0.83+) with a
development build, or on the web, and you are tired of placeholder components
drifting away from the UI they are supposed to imitate.

**Read [`docs/platform-support.md`](docs/platform-support.md) first if** you
ship a universal Expo app, need the debug overlay on a device, or need
per-line text skeletons on native. Those are the three places where what works
on one platform does not work on another, and one of them fails without a
compile error.

**No if** you need Expo Go (a custom native module cannot exist there), or you
use NativeWind (it hard-requires Tailwind v3; this library's theming story is
v4 — [an explicit, evidence-backed exclusion](docs/theming.md), not a gap).

---

## Install

### Bare React Native — RN 0.83+, New Architecture (Fabric) only

```bash
npm install autoskeleton
cd ios && pod install
```

Autolinking is automatic via `@react-native-community/cli`. No manual native
project edits.

### Expo — development build required

```bash
npx expo install autoskeleton
npx expo prebuild
npx expo run:ios     # or run:android, or an EAS development build
```

> **Expo Go does not work, and that is expected — not a bug to file.**
> `autoskeleton` ships a custom native Turbo Module, and custom native modules
> are absent from the prebuilt Expo Go binary by design.
>
> If you run under Expo Go anyway: in development it throws a named,
> actionable error at first use. In a shipped production build it fails open —
> `children` render unwrapped (no skeleton, no crash) and `onMetrics` reports
> `degraded: ['native-module-unavailable']`, so a stray Expo Go install is
> visible in telemetry rather than silently invisible.

### Web

```bash
npm install autoskeleton
```

Nothing else. The native Turbo Module never enters a web bundle — the web
entry's transitive import graph contains no `react-native` specifier at all,
which `test/packaging/entries.test.ts` asserts.

---

## The one behaviour that surprises everyone

**By default, once content has been shown, `isLoading` going back to `true`
does not bring the skeleton back.** The already-rendered content stays on
screen.

That is deliberate: a pull-to-refresh should not blank out the list the reader
is currently looking at. It is also the single most common "my skeleton stopped
working" report, because the first load looks perfect and every load after it
appears to do nothing.

```tsx
<AutoSkeleton isLoading={isLoading} skeletonKey="feed" skeletonOnRefresh>
```

`onMetrics` also stays silent for a suppressed cycle, for the same reason: no
skeleton-to-content lifecycle visually occurred.

---

## What works where

The short version. The long version, with the mechanism behind every gap, is
[`docs/platform-support.md`](docs/platform-support.md).

| | Web | iOS | Android |
|---|---|---|---|
| `<AutoSkeleton>`, `Ignore`, `Hint` | yes | yes | yes |
| Per-line text skeletons | **yes, per line box** | one block per `<Text>` | one block per `<Text>` |
| Virtualized-list API (`SkeletonList` & co.) | **no** | yes | yes |
| `autoskeleton/uniwind` theming | **no** | yes | yes |
| Per-instance `shimmerBaseColor` etc. | **no** | yes | yes |
| CSS-variable / Tailwind v4 theming | yes | n/a | n/a |
| `debugOverlay` draws | yes | **no** | **no** |
| Automatic successor-paint detection | yes | **no** | **no** |
| Clipping to scroll containers | yes | **no** | **no** |
| Tier-2 Skia renderer (opt-in) | n/a | yes | yes |
| Server rendering (`autoskeleton/ssr`) | yes | n/a | n/a |

Two of these bite hardest:

- **The virtualized-list API is native-only and its absence on web is a runtime
  `undefined`, not a compile error.** `expo/tsconfig.base.json` pins
  `customConditions: ['react-native']` for the whole project, so one tsconfig
  typechecks a universal app against the native declarations. Verified by
  running: `tsc --noEmit` exits 0 and `expo export --platform web` bundles
  cleanly. Guard list code with `Platform.OS !== 'web'` or a `.native.tsx`
  file.
- **`debugOverlay` draws on web only.** On iOS and Android the prop is
  accepted, stored, and never read. A blank overlay there is our gap, not your
  configuration.

---

## Documentation

**Getting things done**

- **[API reference](docs/api.md)** — every export, every prop, per-platform
  availability, and the composite cache key.
- **[Platform support and known limitations](docs/platform-support.md)** — the
  honest capability matrix and the mechanism behind every gap.
- **[Troubleshooting](docs/troubleshooting.md)** — symptom → cause → fix,
  including why a library change may not appear in an example app.
- **[Virtualized lists](docs/lists.md)** — native-only, and the explicit-width
  constraint you will hit first.

**Going deeper**

- **[Theming](docs/theming.md)** — the three mechanisms and where each works;
  `autoskeleton/uniwind`; why NativeWind is a non-goal.
- **[Animation and reduced motion](docs/animation.md)** — `shimmer` / `pulse` /
  `none`, and how the OS preference is honoured.
- **[Observability](docs/observability.md)** — `onMetrics` (with a
  **per-platform table of which fields are real**), `debugOverlay`, dev
  warnings, native profiler markers.
- **[Image loading pipeline](docs/image-pipeline.md)** — the
  skeleton → placeholder → image handoff, with a worked `expo-image` example
  that is typechecked in CI against real types.
- **[SSR capture CLI](docs/ssr-capture-cli.md)** — build-time snapshot capture
  for `<AutoSkeletonSSR>`, and the registry-maintenance cost named openly.

**Contributing**

- **[Working on autoskeleton](docs/development.md)** — repo layout, test
  commands, the example apps, and the stale-tarball chain.
- `docs/product-brief.md`, `plan.md`, `spec.md` and `tasks.md` are the design
  and planning record. They document *intent*; where they disagree with the
  code, the code wins.

---

## Optional: the Skia renderer (tier 2)

The default native renderer has **no dependencies** and is what every consumer
gets. It draws on the platform's own compositor (`CAShapeLayer` + gradient on
iOS, one clipped draw pass on Android), so the shimmer keeps running even when
the JS thread is blocked.

A second renderer draws the same skeleton with
[`@shopify/react-native-skia`](https://shopify.github.io/react-native-skia/)
and [`react-native-reanimated`](https://docs.swmansion.com/react-native-reanimated/).
It is strictly opt-in, and opting in is an explicit act — installing the two
packages is **not** enough and deliberately does nothing on its own, because
React Navigation requires Reanimated and "you happen to have it installed" says
nothing about which renderer you want.

```sh
npm install @shopify/react-native-skia react-native-reanimated react-native-worklets
```

Reanimated's Babel plugin must be **last**:

```js
// babel.config.js
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: ['react-native-worklets/plugin'],
};
```

Then build the overlay from **your own** imports and hand it to the provider:

```tsx
import * as Skia from '@shopify/react-native-skia';
import {
  Easing, cancelAnimation, useDerivedValue, useSharedValue,
  withDelay, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import { SkeletonProvider } from 'autoskeleton';
import { createSkiaOverlay } from 'autoskeleton/skia';

// Call ONCE at module scope — a component identity that changes per render
// remounts the whole Skia canvas.
const overlay = createSkiaOverlay({
  skia: Skia,
  reanimated: {
    useSharedValue, useDerivedValue, withRepeat, withTiming,
    withSequence, withDelay, cancelAnimation, Easing,
  },
});

export default function App() {
  return (
    <SkeletonProvider overlay={overlay}>
      <YourApp />
    </SkeletonProvider>
  );
}
```

`onMetrics.renderer` reports `'skia'` for every `<AutoSkeleton>` under that
provider and `'native'` everywhere else, so you can confirm which renderer
actually drew.

You pass the modules in rather than letting the library import them because
Metro builds a **static** dependency graph: an import written in your file is
resolved and bundled, while an import the library only reaches conditionally
either becomes a hard dependency for everyone or does not resolve at all.

**What the two tiers do and do not share.** They share one shimmer *period*,
arbitrated in JS. They do **not** share a phase *origin*: tier-1 reads the
native shimmer clock's `startedAt`, and tier-2 runs entirely in JS with no
route to that value, so it uses its own module-scope origin. Tier-2 instances
are in phase with each other and tier-1 instances with each other, with an
arbitrary fixed offset between the two groups. Per-shape stagger is not
implemented on either tier. A working example lives on the `tier2` screen of
`examples/bare-rn`.

---

## TypeScript configuration

`autoskeleton` publishes **different type declarations per platform
condition**, matching the different JS entry files bundlers already resolve
per platform. For TypeScript to honour them your `tsconfig.json` must:

1. Use `"moduleResolution": "bundler"` or `"node16"`/`"nodenext"` — the classic
   `"node"` resolution ignores `package.json#exports` entirely.
2. For a **React Native** consumer, resolve through the `react-native`
   condition. In practice you rarely set this yourself:
   `@react-native/typescript-config` (which every
   `npx @react-native-community/cli init` project extends) and
   `expo/tsconfig.base` both already ship
   `"customConditions": ["react-native"]`.
3. For a **web bundler** consumer (Vite, Next.js, webpack, plain `tsc`), no
   `customConditions` entry is needed — `default` already resolves to the web
   surface, and `SkeletonList` and friends correctly do **not** resolve there.

> Point 2 is also the trap described above: in a **universal** app that single
> `customConditions` setting makes the native declarations visible to your web
> code too, with no way for TypeScript to know which platform a file will be
> bundled for.

### Jest

Jest's module resolver does **not** apply `package.json#exports` conditions at
all — a Jest limitation, independent of `moduleResolution`. A bare
`require('autoskeleton')` under Jest falls through to `default` (the web build)
even in a React Native test environment:

```js
module.exports = {
  preset: '@react-native/jest-preset',
  testEnvironmentOptions: {
    customExportConditions: ['react-native'],
  },
};
```

See `examples/bare-rn/jest.config.js` for the exact configuration this
repository's own React Native example app uses.

---

## Examples

Four real apps, each installing the library from a packed tarball rather than a
workspace symlink, so what they exercise is the published artifact:

- [`examples/bare-rn`](examples/bare-rn) — bare RN, the full demo gallery, the
  on-device paint gates.
- [`examples/expo`](examples/expo) — Expo autolinking, `autoskeleton/uniwind`,
  `expo-image`, Expo Web.
- [`examples/next`](examples/next) — server rendering.
- [`examples/vite`](examples/vite) — an ordinary web SPA.

## License

MIT © Javier Fuentes
