// test/native/overlay-host-component.test.ts
//
// Visual-paint-gate remediation: `AutoskeletonOverlayHostComponent.tsx`
// must resolve to the CODEGEN'D Fabric component
// (`AutoskeletonOverlayNativeComponent.ts`), never the legacy Paper
// `requireNativeComponent` API this file used before. This test mocks the
// codegen'd spec module directly so it never touches the real
// `react-native` package (unparseable Flow syntax under plain Vitest, same
// rationale as sibling tests in this directory).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakeComponent = { fake: 'AutoskeletonOverlayView-component' };

vi.mock('../../src/native/AutoskeletonOverlayNativeComponent', () => ({
  default: fakeComponent,
}));

describe('resolveAutoskeletonOverlayNativeComponent (visual paint gate remediation)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('resolves to the codegen’d Fabric component instead of requireNativeComponent', async () => {
    const { resolveAutoskeletonOverlayNativeComponent } = await import(
      '../../src/native/renderer/AutoskeletonOverlayHostComponent'
    );
    expect(resolveAutoskeletonOverlayNativeComponent()).toBe(fakeComponent);
  });

  it('memoizes the resolved component across repeated calls', async () => {
    const { resolveAutoskeletonOverlayNativeComponent } = await import(
      '../../src/native/renderer/AutoskeletonOverlayHostComponent'
    );
    const first = resolveAutoskeletonOverlayNativeComponent();
    const second = resolveAutoskeletonOverlayNativeComponent();
    expect(first).toBe(second);
  });

  it('never throws while resolving, even across repeated calls', async () => {
    const { resolveAutoskeletonOverlayNativeComponent } = await import(
      '../../src/native/renderer/AutoskeletonOverlayHostComponent'
    );
    expect(() => resolveAutoskeletonOverlayNativeComponent()).not.toThrow();
    expect(() => resolveAutoskeletonOverlayNativeComponent()).not.toThrow();
  });
});
