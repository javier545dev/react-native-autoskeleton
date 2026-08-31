# The Skia renderer (tier 2)

The opt-in second native renderer: what the default renderer already gives you,
how to wire Skia and Reanimated in yourself, and the one thing the two tiers do
not share. Back to the [README](../README.md).

---

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
