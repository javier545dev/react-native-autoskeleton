// src/index.ts
//
// ADR-3 rule 4: this file exists ONLY so a filename-preserving build emits
// `lib/**/index.js` (the `exports['.'].default` / Metro step-3 target). It
// is NEVER the web resolution mechanism — Metro's step (1) (`.web.js`)
// always wins over step (3) (bare `.js`) before this file is ever reached,
// on every platform including web (`preferNativePlatform` is unconditional,
// brief §2). Re-exporting the web entry keeps this file web-safe (no
// `react-native`/Skia/Reanimated specifier in its transitive graph), which
// is what a `default`-condition consumer (a bundler with no platform
// extension support at all) needs.
export * from './index.web';
