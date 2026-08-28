// src/types/react-native-codegen-types.d.ts
//
// Visual-paint-gate remediation: ambient shim for
// `react-native/Libraries/Types/CodegenTypes`.
//
// `AutoskeletonOverlayNativeComponent.ts` MUST import `Double`/`WithDefault`
// from that exact module specifier — not declare local type aliases with
// matching names — because `@react-native/codegen`'s TypeScript parser
// resolves any `TSTypeAliasDeclaration` present in the SAME source file
// before checking prop types (`parser.js`'s `types[node.id.name] = node`,
// consumed by `getResolvedTypeAnnotation`'s alias-substitution loop). A
// locally-declared `type Double = number` gets silently expanded to a bare
// `TSNumberKeyword` and codegen then rejects it ("must use a specific
// numeric type like Int32, Double, or Float") — verified empirically by
// running `bob build`'s codegen step against a local-alias version of this
// file before writing this shim. An IMPORTED reference is never entered
// into that same-file alias map, so it reaches codegen's emission switch
// unresolved and is recognized by name, exactly as intended.
//
// The import itself does not resolve under plain `tsc`/`bob build`'s
// declaration step in this project: `tsconfig.json` sets `customConditions:
// ["react-native-strict-api"]`, and `react-native`'s own
// `package.json#exports` map nulls out every `./Libraries/*` subpath under
// that condition (verified against `node_modules/react-native/package.json`
// — only the top-level `react-native` entry point resolves in strict-api
// mode, and its re-exported `types_generated/index.d.ts` does not surface
// `Double`/`WithDefault` as members of that top-level module either). This
// ambient declaration is what makes the import resolve for our own
// type-checking while leaving codegen's independent, resolution-agnostic
// parser completely unaffected — codegen never reads this file, it only
// reads runtime JS import specifiers as text.

declare module 'react-native/Libraries/Types/CodegenTypes' {
  export type Double = number;
  export type Float = number;
  export type Int32 = number;
  export type UnsafeObject = object;
  export type UnsafeMixed = unknown;

  type DefaultTypes = number | boolean | string | ReadonlyArray<string>;
  export type WithDefault<
    Type extends DefaultTypes,
    Value extends Type | string | undefined | null,
  > = Type | undefined | null;

  export type EventEmitter<T> = (handler: (arg: T) => void | Promise<void>) => () => void;
}
