// test/native/peer-availability.test.ts
//
// Task 5.4 (tasks.md Phase 5) / plan.md RISK-8: proves tier-2 availability
// detection works correctly for every combination of Skia/Reanimated
// presence, absence and version mismatch — WITHOUT either optional peer
// actually being installed in this repo, via the injectable `PeerRequire`
// seam. This is the direct proof that "the default tier must work fully
// without either installed" is checkable in this repo's own CI.

import { describe, expect, it } from 'vitest';
import { probeReanimated, probeSkia, tier2PeersAvailable } from '../../src/native/tier2/peerAvailability';

function fakeRequire(versions: Record<string, string>) {
  return (specifier: string): unknown => {
    const match = specifier.match(/^(.*)\/package\.json$/);
    if (!match) throw new Error(`unexpected specifier: ${specifier}`);
    const pkgName = match[1]!;
    if (!(pkgName in versions)) {
      const err = new Error(`Cannot find module '${specifier}'`);
      throw err;
    }
    return { version: versions[pkgName] };
  };
}

describe('probeSkia / probeReanimated (task 5.4)', () => {
  it('reports unavailable when the package cannot be required at all', () => {
    const req = fakeRequire({});
    expect(probeSkia(req)).toEqual({ available: false, version: null });
    expect(probeReanimated(req)).toEqual({ available: false, version: null });
  });

  it('reports available when installed at or above the minimum major version', () => {
    const req = fakeRequire({
      '@shopify/react-native-skia': '1.5.0',
      'react-native-reanimated': '4.0.1',
    });
    expect(probeSkia(req)).toEqual({ available: true, version: '1.5.0' });
    expect(probeReanimated(req)).toEqual({ available: true, version: '4.0.1' });
  });

  it('reports unavailable (version-mismatched) when installed BELOW the minimum major version', () => {
    const req = fakeRequire({
      '@shopify/react-native-skia': '0.9.0',
      'react-native-reanimated': '3.9.0',
    });
    expect(probeSkia(req).available).toBe(false);
    expect(probeReanimated(req).available).toBe(false);
  });
});

describe('tier2PeersAvailable (RISK-8: default tier works with either/both absent)', () => {
  it('is false when both peers are absent', () => {
    expect(tier2PeersAvailable(fakeRequire({}))).toBe(false);
  });

  it('is false when only Skia is present', () => {
    expect(
      tier2PeersAvailable(fakeRequire({ '@shopify/react-native-skia': '1.0.0' })),
    ).toBe(false);
  });

  it('is false when only Reanimated is present', () => {
    expect(
      tier2PeersAvailable(fakeRequire({ 'react-native-reanimated': '4.0.0' })),
    ).toBe(false);
  });

  it('is true only when BOTH peers are present at a compatible version', () => {
    expect(
      tier2PeersAvailable(
        fakeRequire({
          '@shopify/react-native-skia': '1.2.0',
          'react-native-reanimated': '4.1.0',
        }),
      ),
    ).toBe(true);
  });

  it('uses the REAL require by default, and does not throw in a repo where neither peer is installed', () => {
    // This IS the default-tier guarantee for THIS repo specifically: no
    // dependency array, no jest/vitest module mock — the real Node
    // `require` resolving against this repo's actual node_modules, which
    // (per ADR-5/RISK-8) does not have either optional peer installed.
    expect(() => tier2PeersAvailable()).not.toThrow();
    expect(tier2PeersAvailable()).toBe(false);
  });
});
