# Working on autoskeleton

For contributors. If you are *using* the library, you want
[`api.md`](./api.md) and [`troubleshooting.md`](./troubleshooting.md) instead.

---

## Layout

```
src/core/      platform-free logic: cache keys, wire format, handoff,
               metrics, line synthesis, hint registry. Zero platform imports.
src/web/       DOM sensor, CSS renderer, debug overlay, SSR components.
src/native/    Turbo Module bridge, native sensor adapter, list API,
               tier-2 Skia renderer.
src/interop/   optional theming interops (uniwind).
src/index*.ts  one entry file per platform condition. See below.
ios/ android/  the native sensor, renderer, shape cache and observability.
cli/           the build-time SSR capture CLI.
test/          Vitest suites that need no browser + Playwright specs that do.
benchmarks/    the CI budget suite; budgets.json is the single source of truth.
examples/      four real consuming apps, installed from a packed tarball.
```

`plan.md`, `spec.md` and `tasks.md` at the repository root are the planning
record. `docs/product-brief.md` is the original design brief. **They are
records of intent, not evidence** — several of their claims turned out not to
match the implementation. When the code and a document disagree, the code wins.

## The entry-point rule

Metro sets `preferNativePlatform: true` unconditionally, even on web. Its
extension search is (1) `.web.js`, (2) `.native.js`, (3) bare `.js`. That is
why there are three files:

- `src/index.web.ts` — the actual web resolution mechanism. Imports only
  `src/web/**` and `src/core/**`; **zero** `react-native`, Skia or Reanimated
  specifiers anywhere in its transitive graph.
- `src/index.native.ts` — iOS and Android.
- `src/index.ts` — exists only so a filename-preserving build emits
  `lib/index.js` for the `default` export condition. It re-exports the web
  entry, which keeps it web-safe.

`test/packaging/entries.test.ts` guards the transitive import graph, and
`test/packaging/web-bundle.test.ts` guards the gzip budget against a real
consumer-style bundle (Rollup tree-shake + esbuild minify), not a library
build.

## Commands

| Command | What it runs |
|---|---|
| `npm test` | Vitest — core, native adapters, packaging, CLI, benchmark support. No browser. |
| `npm run test:web` | Playwright — everything layout-sensitive, plus the SSR and Expo-Web export specs. |
| `npm run typecheck` | `tsc` for `src`/`cli` and `tsc -p tsconfig.tests.json`. |
| `npm run bench` / `bench:run` / `bench:check` | The benchmark suite and its budget gate. |
| `npm run pack:tarball` | `npm pack` into `.tarball/` (runs `prepare` → `bob build` + `build:cli`). |
| `npm run examples:unpin` | Drops the local `file:` tarball integrity pin from every `examples/*/package-lock.json`. **Read the next section before skipping this.** |
| `npm run clean` | Removes `android/build`, `ios/build`, `lib`, `.tarball`. |

Native suites:

```bash
# Android unit tests (Robolectric / host JVM)
cd examples/bare-rn/android && ./gradlew :autoskeleton:testDebugUnitTest

# Android instrumented tests — the real-pixel paint gates, need a live emulator
cd examples/bare-rn/android && ./gradlew :app:connectedDebugAndroidTest

# iOS — the XCTest target under ios/Tests, from Xcode or xcodebuild
```

`examples/bare-rn/android/app/src/androidTest` holds the paint gates: they
rasterize the real screen and assert exact pixel colours, which is how claims
like "the `radius` hint actually clips the corner on Android" and "the tier-1
shimmer keeps running while JS is blocked" get proven rather than asserted.

Per-example scripts:

```bash
cd examples/bare-rn && npm run boot-smoke          # CLI autolinking discovers the package
cd examples/expo    && npm run boot-smoke          # expo config resolves with autoskeleton present
cd examples/expo    && npm run gate:uniwind        # polls the raw Android framebuffer for the theme colours
cd examples/expo    && npm run typecheck:docs-examples
cd examples/next    && npm run boot-smoke          # next build succeeds
cd examples/vite    && npm run boot-smoke          # vite build succeeds
cd examples/vite    && npm run typecheck:cli-consumer
```

---

## The change-does-not-appear chain — read this once

The example apps install `autoskeleton` from
`file:../../.tarball/autoskeleton-0.1.0.tgz`, never a workspace symlink,
because the whole point is to prove the *published artifact* works. That
buys real fidelity and costs one non-obvious failure mode: **a stale install
is silent**.

The path and the version never change, so npm considers the dependency already
satisfied, and the lockfile pins an integrity hash whose matching bytes are
already in npm's content cache.

**Measured in an isolated scratch project on 2026-08-30**, by repacking with
genuinely different bytes and reinstalling:

| Step | Result |
|---|---|
| `npm install` after repacking | `up to date, audited 3 packages`, exit 0, **old bytes** |
| `npm install --force` | `up to date`, exit 0, **old bytes** |
| `rm -rf node_modules/autoskeleton && npm install` | `added 1 package`, exit 0, **still old bytes** — re-hydrated from the npm cache by the pinned hash |
| Drop the lockfile `integrity` for the `file:` tarball, then `npm install` | `changed 1 package`, **fresh bytes** |

Deleting `node_modules` does **not** fix it. The lockfile pin is the
load-bearing part. So the loop is:

```bash
npm run pack:tarball
npm run examples:unpin           # or: node scripts/unpin-local-tarball.mjs examples/next
cd examples/vite && npm install
```

`scripts/unpin-local-tarball.mjs` touches only entries whose `resolved` is a
local `file:` `.tgz`; every registry dependency keeps its real pin, and a
`file:` *directory* dependency (a symlink, which carries no integrity anyway)
is left alone.

Why unpinning is the right call rather than a weakened guarantee: an
`integrity` hash exists to pin an artifact you do not control. This tarball is
this repository's own `npm pack` output, produced from the working tree the
lockfile lives in — pinning it guarantees nothing about provenance and instead
asserts "the library will re-pack to exactly these bytes", which every source
edit falsifies. Keeping it true means repacking and hand-syncing four tracked
lockfiles after every change; this repository already carries a commit whose
entire content is that chore, and it still drifted, which is how `docs.yml`
died with `EINTEGRITY` on a runner whose own tarball was byte-for-byte correct.

Two more caches sit on top:

```bash
npx react-native start --reset-cache     # Metro (bare RN)
npx expo start --clear                   # Metro (Expo)
rm -rf examples/vite/node_modules/.vite  # Vite dependency pre-bundle
```

If a change still does not show up, check it is actually in the artifact:

```bash
tar -tzf .tarball/autoskeleton-0.1.0.tgz | grep <file>
```

`package.json#files` excludes `**/*.test.*`, `__tests__`, `__mocks__`,
`__fixtures__`, dotfiles, and the native build directories.

---

## The example apps, and what each one exists to prove

| App | Proves |
|---|---|
| `examples/bare-rn` | Bare RN is a co-equal target: `@react-native-community/cli` autolinking, the on-device paint gates, tier-2 Skia opt-in, the full platform-neutral demo gallery, and a real `@shopify/flash-list` for cell recycling. |
| `examples/expo` | Expo autolinking, the `autoskeleton/uniwind` interop (native-only, so it has the split `App.web.tsx`), the `expo-image` handoff, and the Expo Web export. |
| `examples/next` | The SSR path end to end, including the capture CLI's ergonomic cost at more than toy scale. |
| `examples/vite` | An ordinary web SPA consuming the published web entry, and the Tailwind v4 theming path against a real production build. |

Three Playwright specs run against a real example app rather than a synthetic
harness, which is why `playwright.yml` installs them:
`test/ssr/dashboard.spec.ts` → `examples/next`,
`test/web/expo-web-export.spec.ts` → `examples/expo`,
`test/web/tailwind-app-theme.spec.ts` → `examples/vite`.

---

## Conventions worth knowing before you send a patch

- **Conventional commits.** No AI attribution or `Co-Authored-By` trailers.
- **`src/core/` has zero platform imports.** Statically asserted by
  `test/packaging/core-styling-agnostic.test.ts` and the entries test. If a
  core module needs a platform fact, it takes it as a parameter.
- **Warnings are split `formatXWarning` / `emitX`.** The formatter is pure and
  unit-testable; the caller decides whether to log and gates on the dev flag.
  A green test on a formatter that nothing calls is a trap this codebase has
  fallen into before — check the call site exists.
- **Dev warnings latch.** Once per distinct value, never per render.
- **A doc claim needs evidence.** If you write that something works, say how
  you know — a test name, a command you ran, a file you read. If you cannot
  verify it, leave it out or mark it unverified. `plan.md` and `tasks.md` are
  not evidence.
- **The NFR-6 gzip budget lives in exactly one place**,
  `benchmarks/budgets.json`'s `webEntryGzipBytes`. It used to live in two and
  they silently diverged by 1706 bytes, both green.

## Known-unverified claims in the planning documents

Flagged so nobody re-derives them as facts:

- **NFR-1's tier-2 120 Hz target is not measured.** `benchmarks.yml`'s
  `bench-ios-traversal` job is marked "AUTHORED ONLY" in its own header and the
  frame-drop job that exists is Android.
- **The native build matrix has run against one pinned RN version**, not the
  full 0.83+ range `native-matrix.yml` expresses.
- **The baseline-vs-candidate ratio gate** has been exercised on hand-fed
  results, not on two real commits in a real Actions run.

Each of these carries an honest scope note in its own workflow file. Keep them
there if you touch those files.
