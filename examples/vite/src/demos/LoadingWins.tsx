// examples/vite/src/demos/LoadingWins.tsx
//
// `isLoading` wins when both props are given (docs/api.md §2.1):
//
//     loading = isLoading is provided ? isLoading : data == null
//
// Both panels below hold the SAME non-null `data` for the whole demo. Only
// the left one also passes `isLoading={isFetching}` — and only the left one
// enters a loading state when the refetch starts. `data` then decides
// nothing about the skeleton; it decides only what the child receives.
//
// This is the shape a data library actually hands you: on a refetch, `data`
// is still the previous value and a separate flag says a request is in
// flight. `data == null` cannot express that, which is why the escape hatch
// exists and why passing both is legal. The right panel is what you get
// without it — correct for a first load, silent for every refetch after it.
//
// Because the value survives the refetch, the children stay mounted, so the
// sensor has real geometry to traverse and the left panel's skeleton is
// MEASURED, not hand-authored. No `fallback` is needed here at all — compare
// `#/cold-fallback`, where the function-child form throws the value away and
// leaves the traversal an empty subtree.
//
// `skeletonOnRefresh` is on both panels and is not the subject: content has
// already been shown by the time the button is pressable, so REQ-PTR-1 would
// otherwise suppress the skeleton on both sides and there would be nothing to
// tell apart. `#/refresh` is where that rule is the subject.
//
// Why a CYCLE COUNTER and not just the metrics line. Both panels mount with
// their value already in hand and both settle a first, one-frame cycle right
// there, so both report `4 shapes` before you have pressed anything — the
// existing `#/refresh` demo's opted-in panel does exactly the same, and its
// numbers are indistinguishable from the ones a refetch produces. Counting
// the cycles is what makes the difference legible: the left panel's count
// goes up when you refetch and the right panel's never does.

import { useState } from 'react'
import { AutoSkeleton, type SkeletonMetrics } from 'autoskeleton'
import { MetricsLine } from './MetricsLine'

const FETCH_MS = 1600

interface Account {
  readonly name: string
  readonly balance: string
}

/** Non-null from the first render: this demo is about a REFETCH, not a cold
 *  start, so there is no first-load skeleton here by design. */
const ACCOUNT: Account = { name: 'Everyday account', balance: '€1,204.75 · updated just now' }

function AccountRow({ account }: { account: Account }) {
  return (
    <article className="demo-card">
      <div className="demo-avatar" />
      <div className="demo-card-body">
        <h3 className="demo-card-title">{account.name}</h3>
        <p className="demo-card-meta">{account.balance}</p>
        <div className="demo-card-action">Details</div>
      </div>
    </article>
  )
}

/** Local variant of `useLastMetrics` that also COUNTS the completed cycles.
 *  `onMetrics` fires once per completed, non-suppressed cycle, so the count is
 *  exactly the number of skeleton lifecycles this wrapper actually had. */
function useMetricsCycles(): {
  metrics: SkeletonMetrics | null
  cycles: number
  onMetrics: (m: SkeletonMetrics) => void
} {
  const [state, setState] = useState<{ metrics: SkeletonMetrics | null; cycles: number }>({
    metrics: null,
    cycles: 0,
  })
  return {
    metrics: state.metrics,
    cycles: state.cycles,
    onMetrics: (m) => setState((prev) => ({ metrics: m, cycles: prev.cycles + 1 })),
  }
}

export function LoadingWins() {
  const [isFetching, setIsFetching] = useState(false)
  const explicit = useMetricsCycles()
  const dataOnly = useMetricsCycles()
  const account: Account = ACCOUNT

  function refetch() {
    setIsFetching(true)
    window.setTimeout(() => setIsFetching(false), FETCH_MS)
  }

  return (
    <>
      <div className="demo-pair">
        <figure className="demo-pair-item">
          <figcaption>
            <code>data</code> + <code>isLoading=&#123;isFetching&#125;</code>
          </figcaption>
          <div data-testid="loading-wins-explicit">
            <AutoSkeleton
              data={account}
              isLoading={isFetching}
              skeletonKey="loading-wins-explicit"
              skeletonOnRefresh
              onMetrics={explicit.onMetrics}
            >
              {(loaded) => <AccountRow account={loaded} />}
            </AutoSkeleton>
          </div>
          <MetricsLine metrics={explicit.metrics} idle="Refetch to record a cycle." />
        </figure>

        <figure className="demo-pair-item">
          <figcaption>
            <code>data</code> alone
          </figcaption>
          <div data-testid="loading-wins-data-only">
            <AutoSkeleton
              data={account}
              skeletonKey="loading-wins-data-only"
              skeletonOnRefresh
              onMetrics={dataOnly.onMetrics}
            >
              {(loaded) => <AccountRow account={loaded} />}
            </AutoSkeleton>
          </div>
          <MetricsLine metrics={dataOnly.metrics} idle="Refetch to record a cycle." />
        </figure>
      </div>

      <div className="demo-controls">
        <button
          type="button"
          className="counter"
          data-testid="loading-wins-refetch"
          disabled={isFetching}
          onClick={refetch}
        >
          {isFetching ? `Refetching for ${FETCH_MS} ms…` : 'Refetch (data stays non-null)'}
        </button>
      </div>
      <p className="demo-readout" data-testid="loading-wins-readout">
        <code>data</code> = <strong>non-null</strong> in both panels ·{' '}
        <code>isFetching</code> = <strong>{String(isFetching)}</strong> · left is{' '}
        <strong>{isFetching ? 'loading' : 'idle'}</strong>, right is <strong>idle</strong> · cycles
        recorded — left <strong data-testid="loading-wins-explicit-cycles">{explicit.cycles}</strong>,
        right <strong data-testid="loading-wins-data-only-cycles">{dataOnly.cycles}</strong>
      </p>
      <p className="demo-note">
        Both counters read <strong>1</strong> before you press anything: each wrapper settled a cycle
        when it mounted with its value already there. Every refetch after that moves the left
        counter and leaves the right one where it is, however many times you press — nothing ever
        told the right panel a request was in flight. That is not a defect in <code>data</code>; it
        is the boundary of what a value can say, and the reason <code>isLoading</code> is allowed to
        override it.
      </p>
    </>
  )
}
