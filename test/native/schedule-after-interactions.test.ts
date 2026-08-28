// test/native/schedule-after-interactions.test.ts
//
// Real, on-device finding (Phase 6 apply session): RN 0.87.1 exports
// `InteractionManager` via a getter that THROWS on read ("InteractionManager
// has been removed from react-native core..."), and Babel's named-import
// interop compiles `InteractionManager` to a property access on the
// `react-native` module object — so even `typeof InteractionManager`
// outside a try/catch propagates that throw. This test mocks that EXACT
// shape (a throwing getter, not a missing export) so a regression to the
// broken "typeof guard outside try/catch" version fails loudly here instead
// of only on a real device.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function mockReactNativeWithThrowingInteractionManager(): void {
  vi.doMock('react-native', () => ({
    get InteractionManager(): never {
      throw new Error(
        "InteractionManager has been removed from react-native core. Please refactor long tasks into smaller ones, and use 'requestIdleCallback' instead.",
      );
    },
  }));
}

function mockReactNativeWithWorkingInteractionManager(runAfterInteractions: (cb: () => void) => { cancel(): void }): void {
  vi.doMock('react-native', () => ({
    InteractionManager: { runAfterInteractions },
  }));
}

describe('scheduleAfterInteractions', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('react-native');
  });

  it('uses InteractionManager.runAfterInteractions when it works', async () => {
    const cancel = vi.fn();
    const runAfterInteractions = vi.fn((cb: () => void) => {
      cb();
      return { cancel };
    });
    mockReactNativeWithWorkingInteractionManager(runAfterInteractions);

    const { scheduleAfterInteractions } = await import('../../src/native/list/scheduleAfterInteractions');
    const callback = vi.fn();
    const handle = scheduleAfterInteractions(callback);

    expect(runAfterInteractions).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
    handle.cancel();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('never throws when InteractionManager is a throwing getter, and falls back to requestIdleCallback', async () => {
    mockReactNativeWithThrowingInteractionManager();
    const cancelIdleCallback = vi.fn();
    const requestIdleCallback = vi.fn((cb: (deadline: unknown) => void) => {
      cb({ didTimeout: false, timeRemaining: () => 0 });
      return 42;
    });
    vi.stubGlobal('requestIdleCallback', requestIdleCallback);
    vi.stubGlobal('cancelIdleCallback', cancelIdleCallback);

    const { scheduleAfterInteractions } = await import('../../src/native/list/scheduleAfterInteractions');
    const callback = vi.fn();

    let handle: { cancel(): void } | undefined;
    expect(() => {
      handle = scheduleAfterInteractions(callback);
    }).not.toThrow();

    expect(requestIdleCallback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
    handle!.cancel();
    expect(cancelIdleCallback).toHaveBeenCalledWith(42);
  });

  it('falls back to setTimeout when neither InteractionManager nor requestIdleCallback are usable', async () => {
    vi.useFakeTimers();
    mockReactNativeWithThrowingInteractionManager();

    const { scheduleAfterInteractions } = await import('../../src/native/list/scheduleAfterInteractions');
    const callback = vi.fn();

    expect(() => scheduleAfterInteractions(callback)).not.toThrow();
    expect(callback).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(callback).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
