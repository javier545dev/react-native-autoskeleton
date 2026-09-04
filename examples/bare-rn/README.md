<img src="../../docs/assets/autoskeleton-logo.svg" alt="" width="64" height="64">

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
2. **The demo gallery** — a grouped index of one browsable screen per
   capability, behind the **Demos ›** button. This is the app to open if you
   want to see what the library does.

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

Tap **Demos ›** in the top-right of the launch screen.

**Home** opens with a one-sentence pitch and a hero card that cycles on its own
— about 1.5 s of skeleton, then the real content — so the transition the
library exists for has happened before you have finished reading the sentence
above it. Below that is the whole index on one scrolling list, split into
section headers. There is no category screen: with fifteen demos a hop per
category would add a tap to every journey and disclose nothing a section header
does not, so **every demo is exactly one tap from home**.

Navigation is hand-rolled (`demos/nav.tsx`): a `useState<Route[]>` stack, one
shared nav bar, and a `BackHandler` subscription so the **Android hardware back
button pops the stack** instead of killing the app — and, at the root of the
gallery, returns to the gate fixtures. There is deliberately no navigation
library: `@react-navigation/native-stack` would pull `react-native-screens`, a
native dependency, into the app whose native build hosts five instrumented
pixel-gate suites, and would need Jest mocks before `__tests__/App.test.tsx`
could render `<App />` at all.

The gallery follows the OS colour scheme. The gate fixture screens deliberately
do not — their background is sampled by the pixel gates.

`demos/registry.ts` is the index; every entry names the file to read and the
group it belongs to. **Rule: nothing goes in that list until it has been
observed working on a device.** A gallery entry is a promise, and a promise the
library cannot keep is worse than a missing demo.

### Start here

| Demo | What it makes obvious |
| --- | --- |
| Cold load | The skeleton comes from the measured layout — you never author one. |
| data-driven loading | Pass the value, not a predicate. Nullish means loading; `0`, `''` and `false` are loaded values. The function child receives `NonNullable<T>`, and `isLoading` still wins when both are given. |

### What gets detected

| Demo | What it makes obvious |
| --- | --- |
| Text | A `<Text>` is one detected leaf. One `<Text>` per line of meaning is the text-shaped skeleton on native. |
| Images | An image is its own leaf; the placeholder keeps the picture's real frame. |
| Scroll clipping | A leaf below the fold of a `<ScrollView>` is clipped away and never spends the shape budget. The same rows in a non-scrolling `overflow: 'hidden'` box are all charged — **6 shapes against 24**, measured on screen. |

### Lifecycle

| Demo | What it makes obvious |
| --- | --- |
| Cold miss & fallback | A strictly conditional child leaves the sensor nothing to measure, so the first loading state of a session paints **nothing** without `fallback`. Two identical instances, one with the prop and one without. |

### Control & opt-out

| Demo | What it makes obvious |
| --- | --- |
| Radius hint | A square view with **no** `borderRadius` — the rounded corner comes only from `<AutoSkeleton.Hint radius>`. On Android this is the mechanism that works. |
| Ignore | A live badge keeps ticking while everything around it is a placeholder. |
| Refresh | Stale-while-revalidate is the default; `skeletonOnRefresh` opts out. Same button, both cards. |
| Delay | A load that resolves in 120 ms should not flash a skeleton. |

### Lists

| Demo | What it makes obvious |
| --- | --- |
| Virtualized lists | All four list APIs on one screen against a real `FlashList`, with the traversal counter on screen. |

### Theming & motion

| Demo | What it makes obvious |
| --- | --- |
| Motion | `shimmer` / `pulse` / `none`, plus the live OS reduce-motion preference — flip it in Settings without relaunching. |
| Theming | Provider defaults overridden per instance; the same props `autoskeleton/uniwind` maps a `className` onto. |
| Writing direction | On native the shimmer sweeps the way you read. One `I18nManager.isRTL` becomes both the cache key's direction segment and the renderer's `writingDirection`, so the snapshot's direction and the sweep's cannot disagree. There is no live toggle — the flag is read once at startup — so the demo flips it and reloads the bundle for you, and says so. |

### Diagnostics

| Demo | What it makes obvious |
| --- | --- |
| Metrics & debug overlay | What it measured, what it cached, and what actually drew. |

### Tier 2 (opt-in)

| Demo | What it makes obvious |
| --- | --- |
| Tier 2 — Skia | The opt-in upgrade, wired the way a consumer wires it. |

Three honest notes about those tables:

- **The `debugOverlay` half of the metrics demo does not draw on this
  platform**, and the demo now says so with the control rendered visibly
  **inert** rather than as a live toggle. On iOS and Android the prop is
  accepted, stored, and never read — the native overlay classes exist and are
  unit-tested but have no production call site. Tapping a toggle that restarts
  a load and changes nothing on screen reads as a broken app rather than as an
  unimplemented platform path. `onMetrics` in that demo is real. See
  [`docs/platform-support.md` §5b](../../docs/platform-support.md).
- **`onMetrics.traversalMs` reads `0.00` here, always.** It is hardcoded on the
  native path; native traversal cost is reported through `os_signpost` / `Trace`
  intervals instead. `radiusSourceHistogram` is likewise all-zeros and
  `degraded` is always empty on native. Full table in
  [`docs/observability.md` §1.1](../../docs/observability.md).
- **The cold-miss demo's second cycle is not as bleak as the docs' worst
  case, and the demo says so.** Measured on an iPhone 17 (iOS 26.5 simulator,
  2026-09-02): cycle 1 leaves the no-`fallback` panel blank for the whole
  2.2 s, and both instances then report `shapeCount: 2` — the traversal caught
  the two `<Text>` leaves in the frame where `data` arrived. So cycle 2 paints
  a measured skeleton in *both* panels and the `fallback` correctly steps
  aside. That rescue is timing, not a contract: `core/snapshot.ts` re-attempts
  an empty measurement only `MAX_EMPTY_MEASUREMENTS` times before it is
  permanent for that key. What `fallback` guarantees is the first cycle of the
  session — the one every new reader sees.

### The list demo's authoring constraint

Found on a device while writing it, and not obvious from the API: the list
template is measured **off-screen**, and the measurement container used to
declare only `left`/`top`, so it laid out at its intrinsic width and any
`flex: 1` child collapsed to zero. The first `FeedRow` used `flex: 1` for its
text column, measured 92 pt wide against a 411 pt row, and every skeleton row
rendered as a lone avatar with nothing beside it.

That is fixed in the library, not worked around in the demo: the container now
declares both horizontal insets, so Yoga resolves it to its parent's content
width — and its parent is the list, which has always known the real width.
`FeedRow` therefore inherits its width and is passed to `renderTemplate`
exactly as written, with no `rowWidth` threaded through anything. See
[`docs/lists.md` §2](../../docs/lists.md).

### Shared with `examples/expo`, and what is not

`demos/theme.ts` (colour, type, spacing, radii, `useDemoTheme`) and
`demos/nav.tsx` (the route stack, the nav bar, the Android back handler) exist
**byte-identically** in both RN example apps:

```bash
diff examples/bare-rn/demos/theme.ts examples/expo/demos/theme.ts   # prints nothing
diff examples/bare-rn/demos/nav.tsx  examples/expo/demos/nav.tsx    # prints nothing
```

They are duplicated rather than extracted to a shared folder because the two
apps keep separate lockfiles, run different React Native versions (0.87.1 vs
0.86.3) and are installed independently in CI from a packed tarball — a shared
folder would need `metro.config` `watchFolders` surgery in both and would
undermine the tarball-install realism that is the point of these examples.

`ui.tsx` and `controls.tsx` stay per-app on purpose: each carries a
load-bearing rule in its header (the naming rule here, a framebuffer colour
rule there) and their needs genuinely differ. Both are built on the same
tokens, which removes the drift that mattered.

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

Four properties of this app are part of that contract and must survive any
redesign of the gallery:

1. **`PaintGateScreen` is mounted at launch.** The gallery is a boolean
   side-route reached only through `demo-open-gallery`.
2. **Exactly one tap on `paint-gate-screen-toggle` reaches the list fixture and
   exactly two reach the tier-2 fixture**, from every cold launch — several
   suites terminate and relaunch mid-test and repeat the same counts.
3. **The header row is exactly 40 pt tall and the switcher is its first
   interactive element**, so every fixture below keeps its previous vertical
   position and the pixel assertions keep their framing.
4. **Nothing under `demos/` may be named with a `paint-gate` or `tier2`
   prefix.** The gates match by prefix as well as exactly
   (`By.descStartsWith("paint-gate-list-real-")`). Every handle in the gallery
   is prefixed `demo-`.

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
