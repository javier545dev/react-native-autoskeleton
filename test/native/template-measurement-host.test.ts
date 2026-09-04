// test/native/template-measurement-host.test.ts
//
// Real, on-device-found regression guard (Phase 6 apply session):
// `TemplateMeasurementHost` originally hid the invisible template with
// `opacity: 0`. `AutoskeletonSensor.kt`'s traversal explicitly skips any
// view with `view.alpha <= 0.01f` (confirmed by reading the source directly
// — android/src/main/java/com/autoskeleton/AutoskeletonSensor.kt:167), so
// every template measurement silently produced a zero-shape snapshot no
// matter what real content `renderTemplate` supplied. Fixed by moving the
// template off-screen instead of hiding it via opacity.
//
// `TemplateMeasurementHost` uses no hooks — calling it directly as a plain
// function (not through a renderer) is valid and returns the exact React
// element `React.createElement` would produce, letting this test inspect
// `.props.style` directly without needing a full RN test renderer (none is
// available under Vitest's node environment — see vitest.config.ts).

import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: Record<string, unknown>) => styles },
  View: 'View',
}));

describe('TemplateMeasurementHost styling — Android alpha<=0.01 sensor-exclusion regression guard', () => {
  it('never sets an opacity the native sensor could treat as invisible (<= 0.01)', async () => {
    const { TemplateMeasurementHost } = await import('../../src/native/list/TemplateMeasurementHost');
    const element = TemplateMeasurementHost({
      node: 'template-content' as unknown as React.ReactNode,
      templateRef: { current: null },
      onLayout: () => undefined,
    }) as unknown as { props: { style: { opacity?: number } | { opacity?: number }[] } };

    const style = element.props.style;
    const styles = Array.isArray(style) ? style : [style];
    for (const s of styles) {
      if (s && typeof s === 'object' && 'opacity' in s && s.opacity !== undefined) {
        expect(s.opacity).toBeGreaterThan(0.01);
      }
    }
  });

  it('positions the template off-screen (large negative left/top) rather than at (0,0)', async () => {
    const { TemplateMeasurementHost } = await import('../../src/native/list/TemplateMeasurementHost');
    const element = TemplateMeasurementHost({
      node: 'template-content' as unknown as React.ReactNode,
      templateRef: { current: null },
      onLayout: () => undefined,
    }) as unknown as { props: { style: { left?: number; top?: number; position?: string } } };

    const { style } = element.props;
    expect(style.position).toBe('absolute');
    expect(style.left).toBeLessThan(-1000);
    expect(style.top).toBeLessThan(-1000);
  });

  it('returns null when there is no pending template (nothing mounted at all)', async () => {
    const { TemplateMeasurementHost } = await import('../../src/native/list/TemplateMeasurementHost');
    const element = TemplateMeasurementHost({
      node: null,
      templateRef: { current: null },
      onLayout: () => undefined,
    });
    expect(element).toBeNull();
  });
});

// SECOND real, on-device-found defect in the SAME two style properties
// (2026-08-30). Moving the template off-screen fixed the alpha exclusion but
// left the container with `left`/`top` and NO horizontal size constraint. An
// absolutely-positioned Yoga box with only a leading position resolves its
// width from its own CONTENT — the intrinsic width — so every `flex: 1` /
// `width: '100%'` child inside the template collapses to zero and either
// vanishes from the snapshot (`frame.w <= 0` is dropped by both native
// sensors) or is measured at a width the real row will never have.
//
// Measured on device while writing `examples/bare-rn/demos/ListDemo.tsx`: a
// row whose text column used `flex: 1` produced a 92.19 x 88 snapshot instead
// of 411.43 x 88, and every skeleton row painted as a lone avatar square.
//
// The width the template needs is not the consumer's to supply — the host's
// own parent IS the list, and it already has the real content width. Setting
// BOTH `left` and `right` makes Yoga resolve the absolute box's width from
// that parent (`width = parentWidth - left - right`), so `left + right === 0`
// yields exactly the parent's content width while `left` keeps the box
// off-screen. That is the invariant this test locks: a horizontal constraint
// that comes from the PARENT, never from the template's own content.
describe('TemplateMeasurementHost sizing — intrinsic-width collapse regression guard', () => {
  it('constrains its width from the parent container instead of its own content', async () => {
    const { TemplateMeasurementHost } = await import('../../src/native/list/TemplateMeasurementHost');
    const element = TemplateMeasurementHost({
      node: 'template-content' as unknown as React.ReactNode,
      templateRef: { current: null },
      onLayout: () => undefined,
    }) as unknown as { props: { style: { left?: number; right?: number; width?: number } } };

    const { style } = element.props;
    expect(
      style.right,
      'an absolute box with `left` but no `right` (and no explicit `width`) is laid out at its ' +
        'INTRINSIC width, which collapses every `flex: 1` / `width: "100%"` child in the template',
    ).toBeDefined();
    expect(
      (style.left ?? 0) + (style.right ?? 0),
      '`left + right` must be exactly 0 so Yoga resolves the box to the parent\'s full content ' +
        'width (parentWidth - left - right) — any other sum measures the template at a width the ' +
        'real row will never have',
    ).toBe(0);
    expect(
      style.width,
      'an explicit `width` would re-introduce a fixed size the parent does not control',
    ).toBeUndefined();
  });
});
