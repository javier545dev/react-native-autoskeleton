# Virtualized lists — **native only**

`SkeletonList`, `SkeletonListFooter`, `SkeletonCell` and `useSkeletonCell` are
exported from the **native entry only**. They do not exist on web, and a
universal Expo app gets no compile error when it imports them — see
[`platform-support.md` §3a](./platform-support.md) before you use these in a
codebase that also targets web.

---

## 1. Why lists need their own API

A whole-screen `<AutoSkeleton>` measures its own children. A list cannot: on
the initial load there are no cells yet, and inside a live recycling list a
traversal on bind would stutter the recycler.

So the list API inverts the flow. **One** invisible template cell is measured
**once per `itemType` for the whole app session**, deferred until interactions
settle, and every skeleton row after that is drawn from the cached snapshot.
Binding a cell does nothing but a synchronous cache read.

Three problems that look like one:

| Component | Problem it solves |
|---|---|
| `<SkeletonList>` | Initial load of an **empty** list — no cells exist to measure, so N synthetic rows are drawn from one measured template. |
| `<SkeletonCell>` | A **single cell** still resolving inside a live list. Zero traversal on bind. |
| `<SkeletonListFooter>` | **Pagination** — same `itemType` as the rows above, so the shapes are already cached by the time it mounts. |
| `useSkeletonCell()` | The hook the components are built on, for a cell that needs the cache state itself. |

All four share one module-scope `templateRegistry`, so "at most once, ever"
holds across every entry point.

---

## 2. The constraint you will hit first: give the template an explicit width

**The template is measured off-screen, inside an absolutely positioned
container that has no width of its own.** So it is laid out at its *intrinsic*
width, and any `flex: 1` or `width: '100%'` child inside it **collapses to
zero**.

This is not theoretical. It was found on a device while writing
`examples/bare-rn/demos/ListDemo.tsx`: the first version of `FeedRow` used
`flex: 1` for its text column, the measured snapshot came back 92 pt wide
instead of the row's full width, and every skeleton row rendered as a lone
avatar square with nothing beside it.

Thread a real width through your template:

```tsx
const rowWidth = useWindowDimensions().width;

function FeedRow({ title, rowWidth }: { title: string; rowWidth: number }) {
  const textWidth = rowWidth - 32 - 48 - 12;
  return (
    <View style={[styles.row, { width: rowWidth }]}>
      <View style={styles.rowAvatar} />
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { width: textWidth }]}>{title}</Text>
        <View style={[styles.rowLine, { width: textWidth * 0.7 }]} />
      </View>
    </View>
  );
}

<SkeletonList
  itemType="feed-row"
  estimatedCount={6}
  renderTemplate={() => <FeedRow title="" rowWidth={rowWidth} />}
/>
```

The mechanism, if you want it: `TemplateMeasurementHost` renders the template
in a `position: 'absolute'` view at `left/top: -10000`. It is off-screen rather
than `opacity: 0` on purpose — the Android sensor skips any view with
`alpha <= 0.01`, so an earlier `opacity: 0` version made every template measure
as zero shapes.

---

## 3. Usage

### Initial load of an empty list

```tsx
<SkeletonList
  itemType="feed-row"
  estimatedCount={6}
  renderTemplate={() => <FeedRow title="" rowWidth={rowWidth} />}
  rowSpacing={8}
/>
```

`skeletonKey` defaults to `itemType`. Set it when two lists on the same screen
share a row shape but should not share a cache entry.

### A cell inside a live list

```tsx
<FlashList
  data={feed}
  renderItem={({ item }) =>
    item.loaded
      ? <FeedRow title={item.title} rowWidth={rowWidth} />
      : <SkeletonCell itemType="feed-row" renderTemplate={() => <FeedRow title="" rowWidth={rowWidth} />} />
  }
/>
```

Use the **same `itemType`** as the real row, and pass the **same component** as
`renderTemplate`. One source of truth means the placeholder cannot drift from
the content.

### Pagination

```tsx
<FlashList
  data={feed}
  ListFooterComponent={
    isLoadingMore
      ? <SkeletonListFooter itemType="feed-row" estimatedCount={3} />
      : null
  }
/>
```

By the time the footer mounts, `feed-row` is already measured, so no template
is needed.

### The hook directly

```tsx
const cell = useSkeletonCell({ itemType: 'feed-row' });
// cell.snapshot   ShapeSnapshot | null
// cell.cacheHit   boolean
// cell.isFallback true while resolving via the generic fallback block
// cell.cacheKey   string
// cell.pendingTemplateNode / templateRef / onTemplateLayout
```

If you use the hook directly and supply a `renderTemplate`, you must render
`pendingTemplateNode` somewhere invisible yourself, wiring `templateRef` and
`onTemplateLayout` onto its container — `<SkeletonCell>` does this for you via
`TemplateMeasurementHost`.

---

## 4. What happens before the template is measured

An `itemType` with no cache entry renders `FallbackSkeletonBlock`: a
deterministic generic block of plain `Animated.View`s pulsing opacity on the
native driver. It is deliberately a **different, simpler** rendering path from
the real tier-1 overlay, because tier-1 reads geometry from the native shape
cache by `cacheKey` and for an unseen `itemType` there genuinely is no data to
read.

`useSkeletonCell().isFallback` tells you which path you are on.

**If you never supply a `renderTemplate`, the fallback renders forever.** That
is a documented v1 limitation, not a bug: nothing is ever crashed or wrong, but
that `itemType` never resolves to real measured geometry. `SkeletonList`,
`SkeletonListFooter` and `SkeletonCell` all behave this way.

---

## 5. The zero-traversal-on-bind guarantee, and how to check it

Binding a cell performs exactly one synchronous cache read. No sensor call is
reachable from the bind path.

`templateTraversalCounter` is exported from the native entry so you can prove
this in your own app. It counts **only traversals that actually executed** via
a deferred template measurement — never a bind:

```tsx
import { templateTraversalCounter } from 'autoskeleton';

// Scroll the list hard. This must NOT climb.
console.log(templateTraversalCounter.count);
```

It is a dev/test observability seam, not a stable public API for production
code. `examples/bare-rn/demos/ListDemo.tsx` renders it on screen for exactly
this purpose.

---

## 6. Measurement lifecycle and its retry budget

1. A bind for an unmeasured `itemType` **claims** it in the shared registry,
   synchronously during render.
2. The template is rendered invisibly and the measurement is deferred via
   `InteractionManager.runAfterInteractions` when available, falling back to
   `requestIdleCallback` (RN 0.87.1 was found to have removed
   `InteractionManager` during this project's own on-device testing).
3. The deferred effect waits for the template's own `onLayout`, bounded to 10
   frames, then measures.
4. The claim resolves to `measured` or `failed`.

A cell recycled to a different `itemType` — or unmounted — while its claim is
still unresolved **releases** the claim on cleanup, so the next bind can retry.
Failures are tracked as a state distinct from `measured`, with a bounded retry
ceiling, so a genuinely unmeasurable template cannot loop forever.

---

## 7. Reduced motion

`SkeletonList`, `SkeletonListFooter` and `SkeletonCell` each read the platform
reduce-motion preference when the `reducedMotion` prop is omitted. Pass
`reducedMotion={false}` explicitly only when you deliberately want motion
regardless — a storybook or a preview. See [`animation.md`](./animation.md).

---

## 8. A working example

`examples/bare-rn/demos/ListDemo.tsx` renders all four APIs on one screen
against a real `@shopify/flash-list`, with the traversal counter on screen. It
uses a real `FlashList` specifically so cell **recycling** is genuinely
exercised rather than simulated.
