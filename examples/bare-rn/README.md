# autoskeleton — bare React Native example

A bare `@react-native-community/cli` app that installs `autoskeleton` the way a
user does — from the packed tarball
(`file:../../.tarball/autoskeleton-0.1.0.tgz`), never a workspace symlink into
this repository's sources.

It is two things at once, and they do not mix:

1. **The on-device paint gates** — deterministic fixture screens whose exact
   pixel colours the instrumented tests assert against. They must be reachable
   from launch with a known number of taps, which is why they are the app's
   root and not a menu entry.
2. **The demo gallery** — one browsable screen per capability, behind the
   **Demos ›** button. This is the app to open if you want to see what the
   library does.

This is also the app that proves **bare RN is a first-class target**, not an
Expo afterthought: nothing here goes through `expo-modules-autolinking`, and
there are zero Expo packages in the tree.

---

## Running it

```bash
npm install
npm start                    # Metro

npm run android              # in another shell
npm run ios                  # ios/ needs `bundle install && bundle exec pod install` first
```

If a library change does not show up, it is almost certainly the stale-install
chain, not your code. See [`docs/development.md`](../../docs/development.md) —
short version:

```bash
cd ../.. && npm run pack:tarball && npm run examples:unpin
cd examples/bare-rn && npm install
npx react-native start --reset-cache
```

`npm run boot-smoke` verifies only that `react-native.config.js` resolves and
CLI autolinking discovers the package. It does not build.

---

## The demo gallery

`demos/registry.ts` is the index; every entry names the file to read. **Rule:
nothing goes in that list until it has been observed working on a device.** A
gallery entry is a promise, and a promise the library cannot keep is worse than
a missing demo.

| Demo | What it makes obvious |
| --- | --- |
| Cold load | The skeleton comes from the measured layout — you never author one. |
| Text | A `<Text>` is one detected leaf. One `<Text>` per line of meaning is the text-shaped skeleton on native. |
| Images | An image is its own leaf; the placeholder keeps the picture's real frame. |
| Radius hint | A square view with **no** `borderRadius` — the rounded corner comes only from `<AutoSkeleton.Hint radius>`. On Android this is the mechanism that works. |
| Ignore | A live badge keeps ticking while everything around it is a placeholder. |
| Virtualized lists | All four list APIs on one screen against a real `FlashList`, with the traversal counter on screen. |
| Refresh | Stale-while-revalidate is the default; `skeletonOnRefresh` opts out. Same button, both cards. |
| Delay | A load that resolves in 120 ms should not flash a skeleton. |
| Motion | `shimmer` / `pulse` / `none`, plus the live OS reduce-motion preference — flip it in Settings without relaunching. |
| Theming | Provider defaults overridden per instance; the same props `autoskeleton/uniwind` maps a `className` onto. |
| Metrics & debug overlay | What it measured, what it cached, and what actually drew. |
| Tier 2 — Skia | The opt-in upgrade, wired the way a consumer wires it. |

Two honest notes about that table:

- **The `debugOverlay` half of the metrics demo does not draw on this
  platform.** On iOS and Android the prop is accepted, stored, and never read
  — the native overlay classes exist and are unit-tested but have no production
  call site. `onMetrics` in that demo is real. See
  [`docs/platform-support.md` §5b](../../docs/platform-support.md).
- **`onMetrics.traversalMs` reads `0.00` here, always.** It is hardcoded on the
  native path; native traversal cost is reported through `os_signpost` / `Trace`
  intervals instead. `radiusSourceHistogram` is likewise all-zeros and
  `degraded` is always empty on native. Full table in
  [`docs/observability.md` §1.1](../../docs/observability.md).

### The list demo's authoring constraint

Found on a device while writing it, and not obvious from the API: the list
template is measured **off-screen inside a container with no width of its
own**, so it lays out at its intrinsic width and any `flex: 1` child collapses
to zero. The first `FeedRow` used `flex: 1` for its text column, measured 92 pt
wide instead of the row's full width, and every skeleton row rendered as a lone
avatar with nothing beside it. `rowWidth` is threaded through the demo for
exactly this reason. See [`docs/lists.md` §2](../../docs/lists.md).

---

## The paint gates

Three fixture screens, cycled by the grey **screen: … (tap to switch)** bar at
the top (`card → list → tier2 → card`):

| Screen | Paired instrumented test |
| --- | --- |
| `card` | `PaintGateInstrumentedTest.kt` — the skeleton genuinely covers the text/image/rounded-card regions; `<AutoSkeleton.Ignore>` genuinely excludes one; `<AutoSkeleton.Hint radius={40}>` genuinely changes a corner pixel on a square view. |
| `list` | `PaintGateListInstrumentedTest.kt`, `PaintGateListFrameDropsInstrumentedTest.kt` — real `FlashList` recycling, the traversal counter staying flat, and native heap growth under recycle stress. |
| `tier2` | `Tier2PaintGateInstrumentedTest.kt` — the tier-2 overlay actually drew, and a late-mounted instance joins the same wave as an early one. |

Plus `AccessibilityGateInstrumentedTest.kt` for the loading announcement.

```bash
cd android && ./gradlew :autoskeleton:testDebugUnitTest    # host-JVM unit tests
cd android && ./gradlew :app:connectedDebugAndroidTest     # needs a live emulator
```

> **Do not change** the `accessibilityLabel`s, `skeletonKey`/`itemType`s, or
> the fixture colours exported from `App.tsx` without updating the paired
> tests. They locate regions by accessibility label and assert exact pixel
> colours, and the colours are deliberately never derived from the skeleton
> theme so a match cannot be a coincidence.

The tier-2 screen also proves the opt-in contract from the consumer side:
`skiaOverlay.ts` holds the single module-scope `createSkiaOverlay` call, with
`@shopify/react-native-skia` and `react-native-reanimated` imported in **this
app's** module graph rather than the library's.

---

## Jest

`jest.config.js` sets `testEnvironmentOptions.customExportConditions:
['react-native']`. Without it, Jest's resolver ignores
`package.json#exports` conditions entirely and `require('autoskeleton')` falls
through to the **web** build even in a React Native test environment. Copy that
config into your own app.
