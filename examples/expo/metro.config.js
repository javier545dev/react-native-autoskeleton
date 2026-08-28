// tasks.md 7.2: wires uniwind's real Metro plugin (`uniwind/metro`,
// `withUniwindConfig`) so `className` on native components resolves at
// build time — required for the `autoskeleton/uniwind` interop's native E2E
// scenario in this example app.
//
// (tasks.md 7.3 also verified `nativewind/metro`'s `withNativeWind` against
// this same file during a separate pass — the two theming engines' Metro
// transforms cannot be wired simultaneously in one app, and NativeWind
// v4.2.6 hard-requires Tailwind v3 while uniwind hard-requires Tailwind v4,
// so this example demonstrates uniwind. See tasks.md 7.3 for the full
// account of the nativewind verification attempt and why it stopped short
// of a running native E2E.)
const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');

const config = getDefaultConfig(__dirname);

module.exports = withUniwindConfig(config, {
  cssEntryFile: './global.css',
});
