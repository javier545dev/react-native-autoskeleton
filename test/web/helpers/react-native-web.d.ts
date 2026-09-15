// test/web/helpers/react-native-web.d.ts
//
// `react-native-web@0.21.2` ships NO TypeScript types (verified: its
// package.json declares neither `types` nor `typings`, and there is no
// `dist/index.d.ts`). The DefinitelyTyped `@types/react-native-web` package
// tracks a much older major and would add a stale dependency for the sake of
// two test harness files, so this local ambient declaration covers exactly
// the surface `test/web/helpers/rnw-entry.ts` re-exports into the browser —
// nothing more. It is a TEST-ONLY declaration: the library itself never
// imports `react-native-web`, and `test/packaging/*` still asserts that.
//
// The prop shapes are deliberately loose. These components are passed
// straight through to `page.evaluate`, where the elements are built with
// `React.createElement` (the G.14 trap: a spec file must never import `.tsx`
// or construct JSX outside the bundled production graph), so precise prop
// typing here would buy nothing and drift against RNW's real surface.

declare module 'react-native-web' {
  import type { ComponentType, ReactNode } from 'react';

  /** A react-native style object (or an array/`false` entry from a
   *  conditional style expression). Values are the CSS-ish numbers and
   *  strings RNW's `StyleSheet` accepts. */
  export type RNWStyleValue = string | number | undefined;
  export type RNWStyle = Readonly<Record<string, RNWStyleValue>>;
  export type RNWStyleProp = RNWStyle | ReadonlyArray<RNWStyle | false | null | undefined>;

  export interface RNWCommonProps {
    readonly style?: RNWStyleProp;
    readonly testID?: string;
    readonly nativeID?: string;
    readonly children?: ReactNode;
  }

  export interface RNWTextProps extends RNWCommonProps {
    readonly numberOfLines?: number;
  }

  export interface RNWImageProps extends RNWCommonProps {
    readonly source?: { readonly uri: string };
    readonly onLoad?: () => void;
  }

  export interface RNWTextInputProps extends RNWCommonProps {
    readonly defaultValue?: string;
  }

  export const View: ComponentType<RNWCommonProps>;
  export const Text: ComponentType<RNWTextProps>;
  export const Image: ComponentType<RNWImageProps>;
  export const TextInput: ComponentType<RNWTextInputProps>;
}
