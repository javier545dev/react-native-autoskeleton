// Three copies of the same vocabulary, kept identical by hand — and they had
// already drifted when this file was written.
//
// `src/core/types.ts` declares `DegradationFlag` and `RadiusSource` as string
// unions. `ios/AutoskeletonTypes.swift` and
// `android/src/main/java/com/autoskeleton/AutoskeletonTypes.kt` each carry a
// mirror enum whose own header claims parity: "Mirrors `DegradationFlag` in
// `src/core/types.ts`" / "the full vocabulary is kept for parity with the
// shared cross-platform telemetry payload". Nothing checked that claim, so:
//
//   * `depth-cap-reached` was added to TS with the web stack-overflow fix and
//     reached neither native enum.
//   * `style` was added to `RadiusSource` with Android's public-API radius
//     rung, reached Kotlin, and never reached Swift.
//
// This is the pattern the repo already proved works for a different shared
// vocabulary: `effectiveAnimation` is pinned against one table in TypeScript,
// Swift AND Kotlin (`core/animation.test.ts`,
// `AutoskeletonAnimationKindTests.swift`, `AutoskeletonAnimationKindTest.kt`),
// which is why that one has never drifted. The difference here is that a
// single Vitest file can read all three sources directly, so the whole check
// lives in one place and runs in the cheap job.
//
// ORDER MATTERS FOR `RadiusSource`, and only for it: `radiusSourceHistogram`
// is encoded positionally in the dev sidecar, so a reordered mirror would
// mislabel every bucket the day sidecars cross the bridge. `DegradationFlag`
// is compared as a SET, because it is only ever matched by string value.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.join(__dirname, '..', '..');
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** Comments are stripped before any enum body is parsed. These files carry
 *  dense doc comments, and prose about the vocabulary uses the same words the
 *  declarations do — a comment reading "inserting a case would re-map every
 *  captured sidecar" parsed as a seventh enum case until this existed. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');
}

/** Every `'quoted-literal'` in a TS string-union declaration. */
function tsUnionMembers(source: string, typeName: string): string[] {
  const declaration = new RegExp(`export type ${typeName} =([\\s\\S]*?);`).exec(source);
  if (declaration === null) {
    throw new Error(`could not find "export type ${typeName}" in src/core/types.ts`);
  }
  return [...declaration[1]!.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]!);
}

/** Every rawValue in a Swift `enum X: String` body, in declaration order.
 *  Swift gives a bare `case measured` an implicit rawValue equal to its own
 *  name, so both spellings have to be read — a regex that only matched the
 *  explicit `= "..."` form silently returned two of six values here, which is
 *  what the non-vacuity assertions below exist to catch. */
function swiftEnumRawValues(source: string, enumName: string): string[] {
  const body = new RegExp(`enum ${enumName}: String \\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (body === null) {
    throw new Error(`could not find "enum ${enumName}: String" in the Swift mirror`);
  }
  return [...body[1]!.matchAll(/case (\w+)(?: = "([a-z-]+)")?/g)].map((m) => m[2] ?? m[1]!);
}

/** Every wire string in a Kotlin `enum class X(val <field>: String)` body. */
function kotlinEnumWireValues(source: string, enumName: string): string[] {
  const body = new RegExp(`enum class ${enumName}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (body === null) {
    throw new Error(`could not find "enum class ${enumName}" in the Kotlin mirror`);
  }
  return [...body[1]!.matchAll(/\w+\("([a-z-]+)"\)/g)].map((m) => m[1]!);
}

/** The members of a `readonly T[]` const, in declaration order. */
function tsPositionalArray(source: string, constName: string): string[] {
  const declaration = new RegExp(`export const ${constName}[^=]*=\\s*\\[([\\s\\S]*?)\\n\\];`).exec(source);
  if (declaration === null) {
    throw new Error(`could not find "export const ${constName}" in src/core/types.ts`);
  }
  return [...declaration[1]!.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]!);
}

const TYPES_TS = withoutComments(read('src/core/types.ts'));
const TYPES_SWIFT = withoutComments(read('ios/AutoskeletonTypes.swift'));
const TYPES_KOTLIN = withoutComments(read('android/src/main/java/com/autoskeleton/AutoskeletonTypes.kt'));

describe('mirrored vocabularies — DegradationFlag', () => {
  const ts = tsUnionMembers(TYPES_TS, 'DegradationFlag');
  const swift = swiftEnumRawValues(TYPES_SWIFT, 'AutoskeletonDegradationFlag');
  const kotlin = kotlinEnumWireValues(TYPES_KOTLIN, 'AutoskeletonDegradationFlag');

  // A parser that silently matched nothing would make every assertion below
  // vacuously true, which is the one way this file could lie.
  it('parsed a non-trivial vocabulary out of all three sources', () => {
    expect(ts.length).toBeGreaterThan(5);
    expect(swift.length).toBeGreaterThan(5);
    expect(kotlin.length).toBeGreaterThan(5);
  });

  it('the Swift mirror carries exactly the TypeScript vocabulary', () => {
    expect(
      [...swift].sort(),
      `ios/AutoskeletonTypes.swift is missing ${JSON.stringify(ts.filter((f) => !swift.includes(f)))} ` +
        `and has extra ${JSON.stringify(swift.filter((f) => !ts.includes(f)))}`
    ).toEqual([...ts].sort());
  });

  it('the Kotlin mirror carries exactly the TypeScript vocabulary', () => {
    expect(
      [...kotlin].sort(),
      `AutoskeletonTypes.kt is missing ${JSON.stringify(ts.filter((f) => !kotlin.includes(f)))} ` +
        `and has extra ${JSON.stringify(kotlin.filter((f) => !ts.includes(f)))}`
    ).toEqual([...ts].sort());
  });
});

describe('mirrored vocabularies — RadiusSource', () => {
  // Compared against RADIUS_SOURCES, not the union: that array IS the wire
  // encoding for the dev sidecar (`RADIUS_SOURCES.indexOf(source)` into an
  // index-aligned Uint8Array) and its own comment declares it APPEND-ONLY,
  // because "inserting one would silently re-map every previously captured
  // sidecar". A union's declaration order means nothing to TypeScript; this
  // array's order is the contract, so it is what the mirrors must match.
  const ts = tsPositionalArray(TYPES_TS, 'RADIUS_SOURCES');
  const swift = swiftEnumRawValues(TYPES_SWIFT, 'AutoskeletonRadiusSource');
  const kotlin = kotlinEnumWireValues(TYPES_KOTLIN, 'AutoskeletonRadiusSource');

  it('parsed a non-trivial vocabulary out of all three sources', () => {
    expect(ts.length).toBeGreaterThan(2);
    expect(swift.length).toBeGreaterThan(2);
    expect(kotlin.length).toBeGreaterThan(2);
  });

  it('the Swift mirror carries exactly the TypeScript vocabulary, IN ORDER', () => {
    expect(
      swift,
      `ios/AutoskeletonTypes.swift diverges from src/core/types.ts. Order is part of the ` +
        `contract here: the radiusSourceHistogram is positional, so a reordered mirror ` +
        `mislabels every bucket the day sidecars cross the bridge.`
    ).toEqual(ts);
  });

  it('the Kotlin mirror carries exactly the TypeScript vocabulary, IN ORDER', () => {
    expect(
      kotlin,
      `AutoskeletonTypes.kt diverges from src/core/types.ts. Order is part of the contract ` +
        `here: the radiusSourceHistogram is positional.`
    ).toEqual(ts);
  });
});
