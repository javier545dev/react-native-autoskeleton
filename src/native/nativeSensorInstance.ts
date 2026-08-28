// src/native/nativeSensorInstance.ts
//
// One shared native `Sensor` instance for the whole app session — mirrors
// `AutoSkeleton.tsx`'s own `defaultStore` shared-singleton pattern. Phase 6
// list components (`SkeletonList`, `SkeletonListFooter`, `useSkeletonCell`)
// need the SAME sensor `native/AutoSkeleton.tsx` already used inline;
// factored out here so neither module constructs its own and both observe
// the same lazily-resolved native module reference (ADR-15: resolved on
// every `measure()` call, never at import time).

import { Platform } from 'react-native';
import { resolveNativeModule } from './nativeModuleAccessor';
import { createNativeSensor } from './sensor';

export const nativeSensor = createNativeSensor({
  platform: Platform.OS === 'android' ? 'android' : 'ios',
  getNativeModule: resolveNativeModule,
});
