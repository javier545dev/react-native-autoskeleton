// examples/vite/src/demos/DataChildFunction.tsx
//
// The duplication `data` removes (docs/api.md §2.1). The two panels below get
// the same value at the same moment and are indistinguishable on screen; the
// difference is entirely in the source, and it is that the left panel states
// one fact twice:
//
//     isLoading={user === null}                 ← "the user has not arrived"
//     {user !== null && <UserCard user={user} />}  ← the same fact, inverted
//
// The second copy is not stylistic. `UserCard` takes `user: User`, never
// `User | null`, so without the guard the left panel does not compile — and
// nothing keeps the two conditions in step if one of them later changes.
//
// The right panel writes the condition once. `data={user}` decides loading,
// and the function child is invoked ONLY when `data` is non-nullish and
// receives `NonNullable<T>` — so `UserCard` gets its `User` with no second
// test and no cast. Inference is automatic; there is no `<AutoSkeleton<User>>`
// anywhere in this file.
//
// Both panels pass `fallback`, and both need it for the same reason: with
// strictly conditional children there is nothing mounted for the sensor to
// measure while the skeleton is up, so neither form has measured geometry on
// a cold start, and without a fallback a wrapper with no children has no box
// either — it would be 0 pixels tall on both sides and there would be nothing
// to compare. So the fallback here is scaffolding, not the subject: it gives
// each wrapper a box. What actually PAINTS in that box on web today is a
// single unclipped block rather than the placeholder itself, which is
// measured and explained in `#/cold-fallback` — the demo where all of this is
// the subject.
//
// One-way on purpose, like `#/cold-load`: REQ-PTR-1 suppresses the skeleton
// for every later cycle of the same wrapper, so reload the page to see the
// cold state again.

import { useState } from 'react'
import { AutoSkeleton } from 'autoskeleton'
import { MetricsLine } from './MetricsLine'
import { useLastMetrics } from './useLastMetrics'

interface User {
  readonly name: string
  readonly role: string
}

const ADA: User = { name: 'Ada Lovelace', role: 'Analytical Engine · 1843' }

/** Takes a `User`. NOT `User | null` — which is exactly why the legacy form
 *  below has to repeat the loading condition as a guard. */
function UserCard({ user }: { user: User }) {
  return (
    <article className="demo-card">
      <div className="demo-avatar" />
      <div className="demo-card-body">
        <h3 className="demo-card-title">{user.name}</h3>
        <p className="demo-card-meta">{user.role}</p>
        <div className="demo-card-action">Follow</div>
      </div>
    </article>
  )
}

/** A hand-authored placeholder, passed as `fallback`. The library wraps it in
 *  the same ignore channel as `<AutoSkeleton.Ignore>`, so it is never
 *  traversed and the cache can never end up holding a skeleton of a skeleton.
 *  Nothing here animates: the app's own chrome never draws moving parts. */
function CardFallback() {
  return (
    <div className="demo-card">
      <div className="demo-avatar" />
      <div className="demo-card-body">
        <span style={{ display: 'block', width: 150, height: 18, borderRadius: 6, background: 'var(--ui-code-bg)' }} />
        <span style={{ display: 'block', width: 210, height: 14, borderRadius: 6, background: 'var(--ui-code-bg)' }} />
        <span style={{ display: 'block', width: 78, height: 29, borderRadius: 6, background: 'var(--ui-code-bg)' }} />
      </div>
    </div>
  )
}

export function DataChildFunction() {
  const [user, setUser] = useState<User | null>(null)
  const legacy = useLastMetrics()
  const dataForm = useLastMetrics()

  return (
    <>
      <div className="demo-pair">
        <figure className="demo-pair-item">
          <figcaption>
            <code>isLoading</code> + an inverted guard
          </figcaption>
          <div data-testid="data-child-legacy">
            <AutoSkeleton
              isLoading={user === null}
              skeletonKey="data-child-legacy"
              fallback={<CardFallback />}
              onMetrics={legacy.onMetrics}
            >
              {user !== null && <UserCard user={user} />}
            </AutoSkeleton>
          </div>
          <MetricsLine metrics={legacy.metrics} idle="Load to record a cycle." />
        </figure>

        <figure className="demo-pair-item">
          <figcaption>
            <code>data</code> + a function child
          </figcaption>
          <div data-testid="data-child-data">
            <AutoSkeleton
              data={user}
              skeletonKey="data-child-data"
              fallback={<CardFallback />}
              onMetrics={dataForm.onMetrics}
            >
              {(loaded) => <UserCard user={loaded} />}
            </AutoSkeleton>
          </div>
          <MetricsLine metrics={dataForm.metrics} idle="Load to record a cycle." />
        </figure>
      </div>

      <div className="demo-controls">
        <button
          type="button"
          className="counter"
          data-testid="data-child-load"
          disabled={user !== null}
          onClick={() => setUser(ADA)}
        >
          {user === null ? 'Load the user' : 'Loaded — reload the page to see it cold again'}
        </button>
      </div>
      <p className="demo-note">
        The panels are identical on screen and their readouts agree, which is the claim: the{' '}
        <code>data</code> form is not a different behaviour, it is the same behaviour with the
        condition stated once. The function child receives <code>User</code>, so TypeScript already
        knows what the left panel had to re-check by hand.
      </p>
      <p className="demo-note">
        Both loading states above are one flat block rather than the avatar-and-bars placeholder each
        panel passes as <code>fallback</code>. That is not these two forms disagreeing — it is what
        the web renderer does with the empty snapshot a conditional subtree produces, measured and
        explained in <code>#/cold-fallback</code>.
      </p>
    </>
  )
}
