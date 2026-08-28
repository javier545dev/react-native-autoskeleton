// test/native/native-module-accessor.test.ts
//
// Task 5.3 (tasks.md Phase 5) / plan.md ADR-15, RISK-10: Expo Go guidance.
// `react-native` itself cannot be imported directly under this repo's plain
// Vitest `node` environment (its `index.js` uses Flow's `import typeof`
// syntax, which is not parseable outside Metro/Babel's Flow-stripping
// transform — confirmed empirically before writing this test) — so
// `TurboModuleRegistry` is mocked at the module boundary, exactly as
// task 5.1's own DoD names ("mocked native module").

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMock = vi.fn();

vi.mock('react-native', () => ({
  TurboModuleRegistry: { get: getMock },
}));

describe('resolveNativeModule / AutoskeletonNativeModuleUnavailableError (task 5.3)', () => {
  beforeEach(() => {
    vi.resetModules();
    getMock.mockReset();
  });

  it('returns the native module when TurboModuleRegistry.get resolves it', async () => {
    const fakeModule = { getShapes: vi.fn(), evictShapes: vi.fn() };
    getMock.mockReturnValue(fakeModule);
    const { resolveNativeModule } = await import('../../src/native/nativeModuleAccessor');
    expect(resolveNativeModule()).toBe(fakeModule);
  });

  it('returns null (never throws) when the native module is absent — the Expo Go case', async () => {
    getMock.mockReturnValue(null);
    const { resolveNativeModule } = await import('../../src/native/nativeModuleAccessor');
    expect(() => resolveNativeModule()).not.toThrow();
    expect(resolveNativeModule()).toBeNull();
  });

  it('AutoskeletonNativeModuleUnavailableError names Expo Go and the development-build fix', async () => {
    const { AutoskeletonNativeModuleUnavailableError } = await import('../../src/native/nativeModuleAccessor');
    const err = new AutoskeletonNativeModuleUnavailableError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AutoskeletonNativeModuleUnavailableError');
    expect(err.message).toMatch(/Expo Go/);
    expect(err.message).toMatch(/development build|expo run|expo prebuild/i);
  });

  it('logNativeModuleUnavailableOnce logs exactly once per process (production fail-open, non-spammy)', async () => {
    const {
      logNativeModuleUnavailableOnce,
      __resetNativeModuleUnavailableWarningForTests,
    } = await import('../../src/native/nativeModuleAccessor');
    __resetNativeModuleUnavailableWarningForTests();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logNativeModuleUnavailableOnce();
    logNativeModuleUnavailableOnce();
    logNativeModuleUnavailableOnce();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toMatch(/Expo Go/);
    warnSpy.mockRestore();
  });

  it('logNativeModuleUnavailableOnce never throws (production fails open, not loud)', async () => {
    const {
      logNativeModuleUnavailableOnce,
      __resetNativeModuleUnavailableWarningForTests,
    } = await import('../../src/native/nativeModuleAccessor');
    __resetNativeModuleUnavailableWarningForTests();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => logNativeModuleUnavailableOnce()).not.toThrow();
    warnSpy.mockRestore();
  });
});
