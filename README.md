# autoskeleton

Automatic skeleton loaders for React Native and web.

> This file currently documents only the TypeScript/packaging configuration
> consumers need for the published `exports` map (see "TypeScript
> configuration" below). The full install/usage guide is tracked separately
> (tasks.md task 9.4) and will replace this note once written.

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
