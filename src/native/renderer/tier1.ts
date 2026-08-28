// src/native/renderer/tier1.ts
//
// Task 5.5: `Renderer<TSurface>` metadata adapter for the native tier-1
// renderer (plan.md §3.5, ADR-5). The ACTUAL draw pass is owned by the
// native `AutoskeletonOverlayView` host component (tasks 3.2/4.4 +
// `AutoskeletonOverlayNativeComponent.ts`) and driven entirely by React's
// own JSX mount/update/unmount lifecycle for that component — there is no
// separate imperative `mount()/update()/destroy()` bridge call to make on
// this platform, unlike the web CSS renderer, which genuinely owns
// imperative DOM mutation outside React (`css-renderer.ts`). This adapter
// exists so tier-1 still satisfies and is testable against the shared
// `Renderer` contract (`kind`, `supportsRadius`, `isAvailable()`), which
// `AutoSkeleton.tsx`'s tier-selection logic (task 5.5) reads to decide
// between tier-1 and tier-2 (task 5.4).

import type { Renderer, RendererHandle, RenderProps } from '../../core/contracts';

/** `TSurface` is intentionally `never` here: tier-1 native rendering is
 *  never invoked imperatively through `.mount()` in production —
 *  `AutoSkeleton.tsx` renders `<AutoskeletonOverlayView>` directly as JSX.
 *  `mount()` still exists (satisfying the contract, and exercised directly
 *  by unit tests) but documents the no-op with a handle whose `update`/
 *  `destroy` are intentionally inert, since there is nothing for THIS
 *  adapter to own — the real lifecycle lives in the native view's own prop
 *  diffing. */
export function createNativeTier1Renderer(): Renderer<never> {
  return {
    kind: 'native',
    supportsRadius: true,
    isAvailable(): boolean {
      return true;
    },
    mount(_surface: never, _props: RenderProps): RendererHandle {
      return {
        update: () => undefined,
        setAnimation: () => undefined,
        destroy: () => undefined,
      };
    },
  };
}
