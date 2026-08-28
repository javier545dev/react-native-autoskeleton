// test/native/overlay-native-component.test.ts
//
// Visual-paint-gate remediation: the codegen'd Fabric component spec for
// the native tier-1 draw surface (`AutoskeletonOverlayView`). Root cause of
// the paint gate's RED state was that this spec never existed —
// `AutoskeletonOverlayHostComponent.tsx` called the legacy Paper API
// `requireNativeComponent` directly, so no ViewManager was ever registered
// and codegen never emitted anything for it (`codegenConfig.type` was
// `"modules"`, not `"all"`).
//
// `codegenNativeComponent` itself uses Flow syntax unparseable outside
// Metro/Babel's Flow-stripping transform (confirmed empirically, same
// rationale as `native-module-accessor.test.ts`), so it is mocked at the
// module boundary. This test asserts the spec registers the EXACT
// component name the Android (`AutoskeletonOverlayViewManager`) and iOS
// (`AutoskeletonOverlayView` Fabric component view) sides must match.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const codegenNativeComponentMock = vi.fn((name: string) => ({ __codegenName: name }));

vi.mock('react-native/Libraries/Utilities/codegenNativeComponent', () => ({
  default: codegenNativeComponentMock,
}));

describe('AutoskeletonOverlayNativeComponent (visual paint gate remediation)', () => {
  beforeEach(() => {
    vi.resetModules();
    codegenNativeComponentMock.mockClear();
  });

  it('registers exactly one native component under the name "AutoskeletonOverlayView"', async () => {
    await import('../../src/native/AutoskeletonOverlayNativeComponent');
    expect(codegenNativeComponentMock).toHaveBeenCalledTimes(1);
    expect(codegenNativeComponentMock).toHaveBeenCalledWith('AutoskeletonOverlayView');
  });

  it('exports the codegen result as the module default export', async () => {
    const mod = await import('../../src/native/AutoskeletonOverlayNativeComponent');
    expect(mod.default).toEqual({ __codegenName: 'AutoskeletonOverlayView' });
  });
});
