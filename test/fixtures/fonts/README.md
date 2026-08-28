# Self-hosted test font

`test-font.woff2` is a Latin-subset build of **Roboto Regular** (Apache License 2.0,
Google Fonts), fetched once at Phase 0 scaffold time and committed here so every
Playwright layout test loads the identical bytes offline and deterministically —
no test may depend on a system font or a live network fetch (plan.md §7.3).

Used via `font-display: block` + `await document.fonts.ready` before any
measurement, in every fixture page across `test/web/` and `test/ssr/`.
