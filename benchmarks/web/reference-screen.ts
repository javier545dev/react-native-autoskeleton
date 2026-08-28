// benchmarks/web/reference-screen.ts
//
// tasks.md 9.1: "30/60-shape reference screens". Generates real DOM markup
// with EXACTLY `shapeCount` detectable leaf shapes — each sibling is a
// childless `<div>` with an opaque background-color, which `src/web/dom-sensor.ts`
// classifies as a 'background' leaf shape (never a 'container', since a
// container needs children). The wrapping container itself has no
// background, so it contributes zero shapes of its own — the count is exact,
// not approximate.

export function buildReferenceScreenHtml(shapeCount: number): string {
  const rows = Array.from(
    { length: shapeCount },
    (_, i) => `<div style="width:80px;height:16px;margin:2px;background:#cccccc;" data-i="${i}"></div>`,
  ).join('');
  return `<div id="root" style="position:relative;display:flex;flex-wrap:wrap;width:400px;">${rows}</div>`;
}
