// ADR-14 (plan.md): explicit platform descriptor so `@react-native-community/cli`
// autolinking discovers this module deterministically (root *.podspec for iOS,
// android/build.gradle for Android) independently of expo-modules-autolinking,
// which reads its own manifest resolution and does not consult this file.
module.exports = {
  dependency: {
    platforms: {
      ios: {},
      android: {},
    },
  },
};
