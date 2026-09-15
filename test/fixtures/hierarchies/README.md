# Shared hierarchy fixtures

Per plan.md §7.1, this directory holds the fixtures that drive the iOS, Android, and
web sensor test harnesses from **one shared source** — the golden-parity mechanism
that keeps all three platforms honest against each other.

Not populated in Phase 0 (scaffold only, strict TDD: no fixture content without a
failing test that consumes it). The first fixtures land alongside the iOS synthetic
view-hierarchy harness (task 3.1) and are immediately reused, unmodified, by the
Android (4.1) and web (2.1) sensor tests and by `test/fixtures/expected/*.json`.

## Format (plan.md §7.1)

A fixture is a JSON tree:

```json
{
  "class": "text | image | input | container",
  "frame": { "x": 0, "y": 0, "w": 100, "h": 20 },
  "backgroundColor": "#RRGGBB",
  "cornerRadius": 8,
  "nativeID": "optional-ignore-or-hint-channel",
  "children": []
}
```

Required cases (plan.md §7.1/§7.2/§7.3), each as its own fixture file:

- nested containers with offsets
- a scrolled ancestor (`UIScrollView` / Android scroll container)
- the container rule, all three branches (leaves present → leaves win; no leaves
  but a non-transparent background → the container itself is emitted; no leaves
  and no background → **nothing is emitted**, even when the box reserves real
  layout space — `container-rule-sized-but-transparent`)
- an `Ignore` subtree (`accessibilityIdentifier` / `nativeID` / `data-*`)
- a collapsed text node that must synthesize N line rects
- a transformed ancestor
- RTL

Expected wire output per fixture lives in `test/fixtures/expected/<name>.json`, one
file per fixture, compared with the platform-appropriate tolerance (0.5 pt iOS,
0.5 dp Android, 0.5 px web).
