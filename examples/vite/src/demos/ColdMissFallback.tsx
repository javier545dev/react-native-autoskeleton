// examples/vite/src/demos/ColdMissFallback.tsx
//
// The structural hole `fallback` exists to close (docs/api.md §2.2), and the
// exact readings this app got out of it. Everything below was observed in this
// app against its own production build; nothing here is inferred from the
// docs.
//
// THE HOLE. The sensor measures the wrapper's CHILDREN, and it only looks
// WHILE the skeleton is up. A function child — or the older
// `{value !== null && …}` — mounts nothing during loading. So the left panel
// on a cold start is a wrapper with no content, no fallback and therefore no
// box at all: its rect is 0×0, `createDomSensor().measure()` returns `null`
// before it traverses anything, no snapshot is ever stored, and `onMetrics`
// (guarded on having a snapshot) never fires. Nothing on screen, nothing
// reported, and — because the subtree is conditional on every cycle — that
// never changes. Blank forever, not blank once.
//
// WHAT `fallback` FIXES. It is rendered in flow, so the wrapper has a box, so
// there is a loading state the reader can actually see. That is the whole
// difference between the two panels, and it is a real one: 0 pixels tall
// versus 111.
//
// WHAT IT DOES NOT FIX ON WEB TODAY, stated here because this app does not
// print claims it has not checked. Giving the wrapper a box also lets the
// traversal run, and the traversal finds nothing — the real children are
// unmounted, and the fallback carries the `<AutoSkeleton.Ignore>` marker, so
// it is skipped. The stored snapshot is EMPTY, and `core/clip-path.ts`'s
// `buildClipPath([])` returns `path("")`, which Chromium rejects as a
// `clip-path` value. Measured on the right panel:
//
//     .askl-overlay   inline clip-path ""      computed clip-path `none`
//                     background rgb(226, 226, 226)      box 296×111
//
// Writing this demo found that defect; `src/web/css-renderer.ts` now returns
// early for a shapeless snapshot, so the fallback is what paints.
// So what you see there is one flat shimmering block the size of the fallback
// — not the avatar-and-three-bars placeholder written below. The fallback
// still decides the geometry, and it is still what stands between the reader
// and a blank page, but on web it is currently underneath the block rather
// than being it. A snapshot with real shapes clips correctly: `#/cold-load`'s
// overlay carries a genuine `path("M 25 17 …")`, checked the same way.
//
// THE EMPTY SNAPSHOT IS WHY THE GATE IS SPELLED THE WAY IT IS. Both components
// write `snapshot === null || isEmptySnapshot(snapshot)`, not "no snapshot".
// Press "Run it again" a few times and watch the right panel:
//
//     mount #1   0 shapes · cache MISS · real traversal   ← empty run 1
//     mount #2   0 shapes · cache MISS · real traversal   ← empty run 2
//     mount #3   0 shapes · cache HIT  · 0.00 ms          ← MAX_EMPTY_MEASUREMENTS
//     mount #4+  0 shapes · cache HIT  · 0.00 ms            spent; empty is final
//
// The loading state is there at every one of those mounts, the permanent ones
// included. A gate that only asked "is the snapshot missing?" would have fired
// on mount #1 and never again, because from mount #2 there IS a snapshot — it
// is simply empty.
//
// "Refresh in place" is the other half of the gate. `showFallback` is
// `props.fallback !== undefined && showSkeleton && noUsableGeometry`, and
// `showSkeleton` is already false on a REQ-PTR-1 suppressed refresh — so
// adding `fallback` for cold starts cannot start covering content the reader
// is still looking at. Here there is no such content either way, because the
// function child let go of its value: both panels simply empty. Keeping `data`
// non-null across a refetch and driving the loading state with `isLoading` is
// the way out of that — `#/loading-wins`.

import { useState } from 'react'
import { AutoSkeleton } from 'autoskeleton'
import { MetricsLine } from './MetricsLine'
import { useLastMetrics } from './useLastMetrics'

const FETCH_MS = 1400

interface Product {
  readonly title: string
  readonly price: string
}

const PRODUCT: Product = { title: 'Field notebook', price: '€18.00 · in stock' }

function ProductContent({ product }: { product: Product }) {
  return (
    <article className="demo-card">
      <div className="demo-avatar" />
      <div className="demo-card-body">
        <h3 className="demo-card-title">{product.title}</h3>
        <p className="demo-card-meta">{product.price}</p>
        <div className="demo-card-action">Add to cart</div>
      </div>
    </article>
  )
}

/** The hand-authored placeholder a consumer would write. Never traversed — the
 *  library wraps it in the `<AutoSkeleton.Ignore>` channel — so it cannot move
 *  the shape count, and nothing in it animates. Its BOX is what reaches the
 *  reader today; this file's header has the measurement for why its shapes do
 *  not. */
function ProductFallback() {
  return (
    <div className="demo-card">
      <div className="demo-avatar" />
      <div className="demo-card-body">
        <span style={{ display: 'block', width: 138, height: 18, borderRadius: 6, background: 'var(--ui-code-bg)' }} />
        <span style={{ display: 'block', width: 190, height: 14, borderRadius: 6, background: 'var(--ui-code-bg)' }} />
        <span style={{ display: 'block', width: 96, height: 29, borderRadius: 6, background: 'var(--ui-code-bg)' }} />
      </div>
    </div>
  )
}

export function ColdMissFallback() {
  const [product, setProduct] = useState<Product | null>(null)
  const [busy, setBusy] = useState(false)
  // Bumping this remounts BOTH wrappers, which is what makes the next loading
  // cycle a genuinely cold one: `everShownContent` resets with the component,
  // so REQ-PTR-1 does not suppress it, and the cache entry survives in the
  // module-level store. Same mechanism as `#/cache-replay`.
  const [mountKey, setMountKey] = useState(0)
  const without = useLastMetrics()
  const withFallback = useLastMetrics()

  function settleAfter(fetchMs: number) {
    setProduct(null)
    setBusy(true)
    window.setTimeout(() => {
      setProduct(PRODUCT)
      setBusy(false)
    }, fetchMs)
  }

  return (
    <>
      <div className="demo-pair" key={mountKey}>
        <figure className="demo-pair-item">
          <figcaption>
            No <code>fallback</code> — no box, no traversal, 0 pixels
          </figcaption>
          <div data-testid="cold-fallback-without">
            <AutoSkeleton data={product} skeletonKey="cold-fallback-without" onMetrics={without.onMetrics}>
              {(loaded) => <ProductContent product={loaded} />}
            </AutoSkeleton>
          </div>
          <MetricsLine
            metrics={without.metrics}
            idle="Nothing reported — a 0×0 wrapper is never traversed, so there is no snapshot and no cycle to report."
          />
        </figure>

        <figure className="demo-pair-item">
          <figcaption>
            <code>fallback</code> — a box, and a loading state you can see
          </figcaption>
          <div data-testid="cold-fallback-with">
            <AutoSkeleton
              data={product}
              skeletonKey="cold-fallback-with"
              fallback={<ProductFallback />}
              onMetrics={withFallback.onMetrics}
            >
              {(loaded) => <ProductContent product={loaded} />}
            </AutoSkeleton>
          </div>
          <MetricsLine metrics={withFallback.metrics} idle="Load to see what the traversal found here." />
        </figure>
      </div>

      <div className="demo-controls">
        <button
          type="button"
          className="counter"
          data-testid="cold-fallback-load"
          disabled={product !== null || busy}
          onClick={() => setProduct(PRODUCT)}
        >
          Load both
        </button>
        <button
          type="button"
          className="counter"
          data-testid="cold-fallback-again"
          disabled={product === null || busy}
          onClick={() => {
            setMountKey((key) => key + 1)
            settleAfter(FETCH_MS)
          }}
        >
          Run it again (fresh mount)
        </button>
        <button
          type="button"
          className="counter"
          data-testid="cold-fallback-refresh"
          disabled={product === null || busy}
          onClick={() => settleAfter(FETCH_MS)}
        >
          Refresh in place (default policy)
        </button>
      </div>

      <p className="demo-readout" data-testid="cold-fallback-readout">
        <code>data</code> = <strong>{product === null ? 'null' : 'Product'}</strong> · mount{' '}
        <strong>#{mountKey + 1}</strong> ·{' '}
        {product === null ? 'loading — compare what each panel has on screen' : 'loaded'}
      </p>
      <p className="demo-note">
        The two readouts disagree, and that is the finding. The left panel reports nothing at all,
        because a 0×0 wrapper is never traversed; the right one reports <strong>0 shapes</strong> — a
        real, empty cache entry. Neither has any measured geometry. Only one of them had a box, and
        therefore only one of them had a loading state at all.
      </p>
      <p className="demo-note" data-testid="cold-fallback-honesty">
        What fills that box is the placeholder written in the source below — and writing this demo
        is what made that true. It used to be covered: a zero-shape snapshot produces{' '}
        <code>clip-path: path(&quot;&quot;)</code>, the browser rejects it, and an unclipped overlay
        painted its base fill across the whole wrapper — measured at <code>296×111</code>,{' '}
        <code>rgb(226, 226, 226)</code>, one flat block where the fallback should have been. The
        renderer now refuses to paint a shapeless overlay at all, so the overlay above is{' '}
        <code>display: none</code> at <code>0×0</code> and the fallback is what you see. Snapshots
        with real shapes are unaffected — compare <code>#/cold-load</code>.
      </p>
      <p className="demo-note">
        <strong>Run it again</strong> remounts both into a fresh cold cycle. Press it a few times and
        the right panel settles on <code>cache HIT</code> with a <code>0.00 ms</code> traversal: the
        bounded re-measure budget is spent and the empty answer is permanent for that key. The
        loading state is still there, because the gate asks whether the snapshot is <em>usable</em>,
        not whether it exists. The left panel is the same 0-pixel gap it was on the first cycle, and
        will be forever. <strong>Refresh in place</strong> empties both instead — that cycle is
        suppressed by REQ-PTR-1, and the fallback is withheld by the same <code>showSkeleton</code>{' '}
        gate as the skeleton, so adding <code>fallback</code> for cold starts cannot blank out a
        pull-to-refresh.
      </p>
    </>
  )
}
