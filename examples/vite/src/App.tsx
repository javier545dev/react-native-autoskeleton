import { useState } from 'react'
import { AutoSkeleton } from 'autoskeleton'
import heroImg from './assets/hero.png'
import reactLogo from './assets/react.svg'
import viteLogo from './assets/vite.svg'
import './App.css'

// tasks.md 8.4 (ADR-16 / RISK-11): a real, wired demo of the image-handoff
// no-flash guarantee — proven end to end under Playwright in
// `test/web/handoff.spec.ts`, reproduced here against a real consuming app.
// `expectsPlaceholder` tells the controller to wait for the real `<img>`
// successor (auto-detected via `usePaintDetectionHeuristic`'s double-rAF +
// `img.decode()` heuristic, zero extra wiring) rather than fading
// immediately — reveal-before-hide means the hero image is ALWAYS mounted
// underneath the still-painted skeleton, so there is never a frame with
// neither on screen.
function HeroWithSkeleton() {
  const [isLoading, setIsLoading] = useState(true)
  // The image drives the FIRST handoff on its own, which is the honest demo:
  // a real consumer's skeleton disappears when the thing it stands in for
  // arrives. On localhost with a warm cache that happens in the same tick, so
  // the loading state is real but unobservable — hence the manual control
  // below, which lets you put it back and actually look at it.
  return (
    <div className="hero">
      <button
        type="button"
        className="counter"
        data-testid="toggle-loading"
        style={{ marginBottom: 12 }}
        onClick={() => setIsLoading((v) => !v)}
      >
        {isLoading ? 'Stop loading' : 'Replay loading'}
      </button>
      {/* `skeletonOnRefresh` is REQUIRED for the replay button to show anything.
          Without it, REQ-PTR-1's stale-while-revalidate default suppresses the
          skeleton on every load AFTER the first — deliberately, so a refresh
          does not blank out content the reader is already looking at. Opting in
          here is what makes the loading state observable on demand. */}
      <AutoSkeleton isLoading={isLoading} skeletonKey="vite-hero" expectsPlaceholder skeletonOnRefresh>
        <img
          src={heroImg}
          className="base"
          width="170"
          height="179"
          alt=""
          onLoad={() => setIsLoading(false)}
        />
      </AutoSkeleton>
      <img src={reactLogo} className="framework" alt="React logo" />
      <img src={viteLogo} className="vite" alt="Vite logo" />
    </div>
  )
}

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <section id="center">
        <HeroWithSkeleton />
        <div>
          <h1>Get started</h1>
          <p>
            Edit <code>src/App.tsx</code> and save to test <code>HMR</code>
          </p>
        </div>
        <button
          type="button"
          className="counter"
          onClick={() => setCount((count) => count + 1)}
        >
          Count is {count}
        </button>
      </section>

      <div className="ticks"></div>

      <section id="next-steps">
        <div id="docs">
          <svg className="icon" role="presentation" aria-hidden="true">
            <use href="/icons.svg#documentation-icon"></use>
          </svg>
          <h2>Documentation</h2>
          <p>Your questions, answered</p>
          <ul>
            <li>
              <a href="https://vite.dev/" target="_blank">
                <img className="logo" src={viteLogo} alt="" />
                Explore Vite
              </a>
            </li>
            <li>
              <a href="https://react.dev/" target="_blank">
                <img className="button-icon" src={reactLogo} alt="" />
                Learn more
              </a>
            </li>
          </ul>
        </div>
        <div id="social">
          <svg className="icon" role="presentation" aria-hidden="true">
            <use href="/icons.svg#social-icon"></use>
          </svg>
          <h2>Connect with us</h2>
          <p>Join the Vite community</p>
          <ul>
            <li>
              <a href="https://github.com/vitejs/vite" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#github-icon"></use>
                </svg>
                GitHub
              </a>
            </li>
            <li>
              <a href="https://chat.vite.dev/" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#discord-icon"></use>
                </svg>
                Discord
              </a>
            </li>
            <li>
              <a href="https://x.com/vite_js" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#x-icon"></use>
                </svg>
                X.com
              </a>
            </li>
            <li>
              <a href="https://bsky.app/profile/vite.dev" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#bluesky-icon"></use>
                </svg>
                Bluesky
              </a>
            </li>
          </ul>
        </div>
      </section>

      <div className="ticks"></div>
      <section id="spacer"></section>
    </>
  )
}

export default App
