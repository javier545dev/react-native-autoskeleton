# autoskeleton

Automatic skeleton loaders for React Native and web. One sensor that reads
your existing layout and paints a faithful shimmer skeleton over it — no
hand-authored placeholder shapes, no separate skeleton component tree to
keep in sync with your real UI.

## Install

### Bare React Native (RN >= 0.83, New Architecture / Fabric only)

```bash
npm install autoskeleton
cd ios && pod install
```

Autolinking is automatic via `@react-native-community/cli` — no manual
native project edits required.

### Expo (development build required — see the Expo Go note directly below)

```bash
npx expo install autoskeleton
npx expo prebuild
```

> **Expo Go does not work with this library, and that is expected —
> not a bug to file.** `autoskeleton` ships a custom native Turbo Module,
> and custom native modules are absent from the prebuilt Expo Go binary by
> design. You need a **development build** (`expo prebuild` + `expo run:ios`
> / `expo run:android`, or an EAS development build) — a plain `expo start`
> pointed at Expo Go will not have the native module available.
>
> If you run under Expo Go anyway: in development, `autoskeleton` throws a
> named, actionable error at first use telling you exactly this. In a
> shipped production build, it fails open instead — `children` render
> unwrapped (no skeleton, no crash) and `onMetrics` reports
> `degraded: ['native-module-unavailable']`, so a stray Expo Go install is
> visible in your telemetry rather than silently invisible.

Web is unaffected by any of the above — the native Turbo Module never
enters any web bundle (see `docs/theming.md`'s bundle-size notes and
`test/packaging/entries.test.ts`'s transitive-import-graph guard).

## Quick start

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

That's it for the simple case — `autoskeleton` measures the real
`ProductContent` layout the first time it renders, caches the result by
`skeletonKey`, and replays a shimmer skeleton over the identical geometry on
every subsequent loading state (including on a fresh mount, before
`ProductContent` exists at all).

## Learn more

- **[Image loading pipeline](docs/image-pipeline.md)** — the full
  skeleton → placeholder → image handoff, with a worked `expo-image`
  example (verified in CI against real types — see `docs/image-pipeline.md`
  §3).
- **[Theming](docs/theming.md)** — `autoskeleton/uniwind`, and why
  NativeWind is an explicit non-goal, not a gap.
- **[Observability](docs/observability.md)** — `debugOverlay`, dev budget
  warnings, and `onMetrics`.
- **[SSR capture CLI](docs/ssr-capture-cli.md)** — build-time snapshot
  capture for `<AutoSkeleton.SSR>`, including the registry-maintenance cost
  (RISK-4) named openly.

## TypeScript configuration

`autoskeleton`'s `package.json#exports['.']` publishes **different type
declarations per platform condition**, matching the different JS entry
files Metro/bundlers already resolve per platform (`react-native` →
`index.native.js`, `browser` → `index.web.js`, everything else →
`index.js`, which re-exports the web build). Native-list components
(`SkeletonList`, `SkeletonListFooter`, `SkeletonCell`, `useSkeletonCell`)
are exported ONLY from the native entry — a web consumer intentionally
cannot import them.

For TypeScript to pick the right declaration file, your `tsconfig.json`
must:

1. Use `"moduleResolution": "bundler"` or `"node16"`/`"nodenext"` (required
   for TypeScript to honor `package.json#exports` at all — the classic
   `"node"` resolution ignores `exports` entirely).
2. For a **React Native** consumer, set `"customConditions": ["react-native"]`
   so TypeScript resolves through the `react-native` condition instead of
   falling through to the (web-facing) default. **In practice you rarely
   need to set this yourself** — `@react-native/typescript-config` (the
   config every `npx @react-native-community/cli init` project extends)
   already ships `"customConditions": ["react-native"]`. If your project
   extends that config, `import { SkeletonList } from 'autoskeleton'`
   typechecks with no further setup.
3. For a **web bundler consumer** (Vite, Next.js, webpack, plain `tsc`),
   no `customConditions` entry is needed — the `default` condition already
   resolves to the web-facing surface. `SkeletonList` and friends correctly
   do **not** resolve there; only `AutoSkeleton`, `SkeletonProvider`, and
   the shared type exports are visible.

### Jest

Jest's default module resolver does **not** apply `package.json#exports`
conditions at all (this is a Jest limitation, independent of the
`moduleResolution` setting above). A bare `require('autoskeleton')` under
Jest falls through to the `default` condition — the web build — even in a
React Native test environment. Add this to your Jest config:

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
