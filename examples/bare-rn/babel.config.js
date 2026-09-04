module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // `react-native-worklets/plugin` is REQUIRED by Reanimated 4 (the worklet
  // runtime moved out of `react-native-reanimated/plugin` into its own
  // `react-native-worklets` package in v4) and it MUST be last in the list.
  // Without it every `useDerivedValue`/`withTiming` body silently stays on
  // the JS thread, which is exactly the property tier-2 exists to avoid.
  plugins: ['react-native-worklets/plugin'],
};
