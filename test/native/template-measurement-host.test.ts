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
