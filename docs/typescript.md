# TypeScript configuration

What your `tsconfig.json` must do for TypeScript to resolve this package's
per-platform type declarations, and the separate setting Jest needs. Back to the
[README](../README.md).

---

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

## Jest

Jest's module resolver does **not** apply `package.json#exports` conditions at
all — a Jest limitation, independent of `moduleResolution`. A bare
`require('autoskeleton')` under Jest therefore never sees the `react-native`
condition — nor the `require` condition the package now declares. Resolution
falls back to `package.json#main`, which is the CommonJS build of the
platform-neutral entry, and that re-exports the web build. So you get the web
build even in a React Native test environment:

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
