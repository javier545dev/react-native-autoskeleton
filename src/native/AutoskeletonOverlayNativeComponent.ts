// src/native/AutoskeletonOverlayNativeComponent.ts
//
// Visual-paint-gate remediation (tasks.md Phase 5, task 5.7 follow-up) /
// plan.md ADR-5, ADR-9: the codegen'd Fabric component spec for the native
// tier-1 draw surface ("AutoskeletonOverlayView"). This is the file that
// was MISSING and is the actual root cause of the paint gate's RED state:
// without a `*NativeComponent.ts` file calling `codegenNativeComponent`,
// codegen never emits a ComponentDescriptor/ShadowNode/Props pair for this
// view on either platform, no matter what a hand-written ViewManager does
// — Fabric only mounts views it has generated a descriptor for.
//
// The filename suffix `NativeComponent.ts` is not cosmetic: RN's codegen
// CLI discovers component specs by scanning for files matching
// `*NativeComponent.{js,ts,tsx}` under `codegenConfig.jsSrcsDir`, and
// `@react-native/babel-preset`'s codegen Babel plugin only statically
// rewrites `codegenNativeComponent(...)` calls made from within a file with
// that exact suffix (see `codegenNativeComponent.js`'s own doc comment:
// "this function runs at runtime if codegenNativeComponent was not called
// from a file suffixed with NativeComponent.js" — the un-rewritten runtime
// path falls back to the LEGACY `requireNativeComponent`, i.e. exactly the
// bug this file fixes).
//
// ADR-9 in practice: this component receives `cacheKey` (plus theme/
// animation) as PROPS, never shapes. The native view reads geometry from
// `NativeShapeCache[cacheKey]` — populated by the SAME native `getShapes`
// call `AutoSkeleton.tsx` already made to populate the JS mirror — so
// shapes never round-trip JS -> native a second time at mount.

import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';
import type { ViewProps } from 'react-native';
// `Double`/`WithDefault` MUST be a real import from this exact module, not
// a local `type X = ...` alias with a matching name: `@react-native/
// codegen`'s TypeScript parser collects every `TSTypeAliasDeclaration` in
// the parsed file into a same-file substitution map and resolves prop
// types through it BEFORE checking for `Double`/`Int32`/`Float`/
// `WithDefault` by name (`parser.js`: `types[node.id.name] = node`, walked
// by `getResolvedTypeAnnotation`). A local alias like `type Double =
// number` is silently expanded to a bare `number` and codegen then
// rejects the prop ("must use a specific numeric type like Int32, Double,
// or Float") — verified empirically by running `bob build`'s codegen
// target against a local-alias version of this file before switching to
// this import. An imported reference is never entered into that map, so
// it reaches codegen's emission switch unresolved and is matched by name,
// exactly as required.
//
// This import does not resolve through `react-native`'s real
// `package.json#exports` map under this project's `tsconfig.json`
// `customConditions: ["react-native-strict-api"]` (that condition nulls
// out every `./Libraries/*` subpath — verified against
// `node_modules/react-native/package.json`), so
// `src/types/react-native-codegen-types.d.ts` ambiently declares this
// exact module specifier for our own `tsc`/`bob build` declaration step.
// Codegen itself never resolves this specifier at all — its parser only
// reads the import text, so the ambient shim is invisible to it.
import type { Double, WithDefault } from 'react-native/Libraries/Types/CodegenTypes';

export interface NativeProps extends ViewProps {
  readonly cacheKey: string;
  readonly baseColor: string;
  readonly highlightColor: string;
  readonly defaultRadius: Double;
  readonly speedMs: Double;
  readonly animation?: WithDefault<'shimmer' | 'pulse' | 'none', 'shimmer'>;
  readonly reducedMotion: boolean;
  /** The writing direction the snapshot behind `cacheKey` was measured for —
   *  literally the same value `composeCacheKey` received, so the sweep can
   *  never travel against the geometry it is painting.
   *
   *  DELIBERATELY NOT NAMED `direction`. `NativeProps extends ViewProps`, and
   *  Fabric's C++ `ViewProps` inherits `YogaStylableProps`, which already
   *  parses a raw prop literally called `direction` into its `YGStyle`
   *  (`YogaStylableProps.cpp`) — and its accepted values are the very strings
   *  this prop carries, `"ltr"`/`"rtl"`. Declaring `direction` here would not
   *  collide at the C++ member level (Yoga's lands inside `yogaStyle`, not as a
   *  member of that name), but BOTH parsers read the same `RawProps` entry, so
   *  setting this prop would silently also set the overlay's Yoga layout
   *  direction. That is a side effect nobody asked for on a view whose whole
   *  job is to be an `absoluteFill` sibling, so the prop carries the name of
   *  the quantity instead, which collides with nothing.
   *
   *  `WithDefault<..., 'ltr'>` keeps every existing consumer byte-identical:
   *  an omitted prop is `'ltr'`, which is the only behaviour any renderer had
   *  before this field existed. */
  readonly writingDirection?: WithDefault<'ltr' | 'rtl', 'ltr'>;
  /** REQ-OBS-OVERLAY-1: delegates to the existing native
   *  `AutoskeletonDebugOverlay` (tasks 3.3/4.5) — outline + index/source/
   *  hit-miss + radius-rung badge per shape, dev-build only. */
  readonly debugOverlay: boolean;
}

export default codegenNativeComponent<NativeProps>('AutoskeletonOverlayView');
