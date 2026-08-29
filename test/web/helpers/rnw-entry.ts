// test/web/helpers/rnw-entry.ts
//
// esbuild entry for `test/web/react-native-web.spec.ts` (tasks.md G.17).
// Bundles the REAL `react-native-web` component graph together with the REAL
// production `<AutoSkeleton>`/`SkeletonProvider` and the REAL `createDomSensor`
// — never a hand-rolled stand-in for either side. This is the only place in
// the repo where the library's own web graph and `react-native-web` meet, and
// it exists so a spec can ask the sensor what it sees in genuine RNW DOM
// output (divs with generated atomic classes) rather than in the ordinary
// semantic markup every other web spec feeds it.
//
// This harness bundle's size is irrelevant: NFR-6 is measured separately by
// `test/packaging/web-bundle.test.ts` against `lib/module/index.web.js`, and
// `react-native-web` is a devDependency that no shipped entry imports (still
// asserted by `test/packaging/*`).

import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Image, Text, TextInput, View } from 'react-native-web';
import { AutoSkeleton, SkeletonProvider } from '../../../src/web/AutoSkeleton';
import { MemoryShapeStore } from '../../../src/core/snapshot';
import { createDomSensor, createEmptyHintRegistry, SHAPE_SOURCES } from '../../../src/web/dom-sensor';
import { decodeWire } from '../../../src/core/wire';

declare global {
  interface Window {
    AutoskeletonRnw: {
      React: typeof React;
      createRoot: typeof createRoot;
      View: typeof View;
      Text: typeof Text;
      Image: typeof Image;
      TextInput: typeof TextInput;
      AutoSkeleton: typeof AutoSkeleton;
      SkeletonProvider: typeof SkeletonProvider;
      MemoryShapeStore: typeof MemoryShapeStore;
      createDomSensor: typeof createDomSensor;
      createEmptyHintRegistry: typeof createEmptyHintRegistry;
      decodeWire: typeof decodeWire;
      SHAPE_SOURCES: typeof SHAPE_SOURCES;
    };
  }
}

window.AutoskeletonRnw = {
  React,
  createRoot,
  View,
  Text,
  Image,
  TextInput,
  AutoSkeleton,
  SkeletonProvider,
  MemoryShapeStore,
  createDomSensor,
  createEmptyHintRegistry,
  decodeWire,
  SHAPE_SOURCES,
};
