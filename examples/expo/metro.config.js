// tasks.md 7.2: wires uniwind's real Metro plugin (`uniwind/metro`,
// `withUniwindConfig`) so `className` on native components resolves at
// build time — required for the `autoskeleton/uniwind` interop's native E2E
// scenario in this example app.
//
// uniwind is the sole theming interop (tasks.md 7.5, maintainer decision,
// 2026-08-28): NativeWind 4.2.6 hard-requires Tailwind v3, incompatible with
// this project's Tailwind-v4 theming story. See spec.md §1.9 / §5,
// docs/product-brief.md §9, plan.md ADR-17 for the measured reasoning.
const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');

const config = getDefaultConfig(__dirname);

module.exports = withUniwindConfig(config, {
  cssEntryFile: './global.css',
});
