// src/native/tier2/peerAvailability.ts
//
// Task 5.4 (tasks.md Phase 5) / plan.md ADR-5, RISK-8: `@shopify/react-
// native-skia` and `react-native-reanimated` are OPTIONAL peer
// dependencies (package.json `peerDependenciesMeta.optional`). Nothing in
// this file statically imports either package — only `require()` inside a
// try/catch, guarded behind a function call — so a consumer with neither
// peer installed never fails to resolve this module, and the default tier
// (tier-1) never depends on it being resolvable at all.
//
// Version-mismatch detection (RISK-8: "Reanimated 4 / Skia dependency
// chain … version-matched") reads each package's own `package.json#version`
// rather than parsing a semver range itself, keeping this dependency-free.

const MIN_SKIA_MAJOR = 1;
const MIN_REANIMATED_MAJOR = 4;

export interface PeerModuleProbe {
  readonly available: boolean;
  readonly version: string | null;
}

function majorVersion(version: string): number {
  const first = version.split('.')[0] ?? '';
  const n = Number.parseInt(first, 10);
  return Number.isNaN(n) ? 0 : n;
}

/** Injectable `require`-like loader so this is testable without either peer
 *  actually being installed in this repo (the default-tier guarantee this
 *  task exists to prove). Defaults to the real Node/Metro `require`. */
export type PeerRequire = (specifier: string) => unknown;

function defaultRequire(specifier: string): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(specifier);
}

function probe(specifier: string, minMajor: number, requireFn: PeerRequire): PeerModuleProbe {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pkg = requireFn(`${specifier}/package.json`) as { version?: string } | undefined;
    const version = pkg?.version ?? null;
    if (!version) {
      return { available: false, version: null };
    }
    return { available: majorVersion(version) >= minMajor, version };
  } catch {
    return { available: false, version: null };
  }
}

export function probeSkia(requireFn: PeerRequire = defaultRequire): PeerModuleProbe {
  return probe('@shopify/react-native-skia', MIN_SKIA_MAJOR, requireFn);
}

export function probeReanimated(requireFn: PeerRequire = defaultRequire): PeerModuleProbe {
  return probe('react-native-reanimated', MIN_REANIMATED_MAJOR, requireFn);
}

/** Tier-2 is available only when BOTH optional peers resolve and meet the
 *  minimum version floor (RISK-8) — a mismatched or half-installed pair
 *  falls back to tier-1 exactly like a fully-absent pair, silently. */
export function tier2PeersAvailable(requireFn: PeerRequire = defaultRequire): boolean {
  return probeSkia(requireFn).available && probeReanimated(requireFn).available;
}
