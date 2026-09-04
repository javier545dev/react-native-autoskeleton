# `examples/rn-077` — the support floor, as a build

`package.json` declares `react-native: ">=0.77.0"`. This app is why that number
is allowed to be there.

## What this exists to settle

The claim had two supports, both read off source rather than run:

- **Android.** `AutoskeletonPackage.kt` passes *named* arguments to
  `ReactModuleInfo`. In `react-native@0.76.9` that constructor's parameters are
  `_name`, `_className`, `_canOverrideExistingModule`, `_needsEagerInit`; in
  `0.77.0` they lose the underscore. The named call binds in 0.77 and matches no
  overload in 0.76.
- **iOS.** `codegenConfig.ios.componentProvider` feeds
  `RCTThirdPartyComponentsProvider.mm`. Grepping the published tarballs,
  `0.76.9` contains no such generator anywhere under `scripts/`, `React/` or
  `Libraries/`; `0.77.0` ships it in
  `scripts/codegen/generate-artifacts-executor.js` plus its two templates.

Both are compile-time facts, so a native build is the evidence. This app is that
build.

## Why it is a separate app rather than a matrix row

`native-matrix.yml` used to cover 0.77 by taking `examples/bare-rn` — a React
Native **0.87** app pinned to Kotlin 2.2.0 and Gradle 9.4.1 — and swapping its
JavaScript dependencies down. All ten sub-0.87 Android rows failed, and none of
them failed inside this library: React Native's own
`react-native-gradle-plugin` does not compile under a toolchain that new
(`:gradle-plugin:shared:compileKotlin`, a Kotlin `FileAnalysisException`).

Swapping the JS dependencies does not make an app that version. This one was
scaffolded as 0.77 and left alone:

| | value | where it comes from |
|---|---|---|
| react-native | 0.77.3 | `@react-native-community/cli@15.0.1 --version 0.77.3` |
| Kotlin | 2.0.21 | the 0.77 template, untouched |
| Gradle | 8.10.2 | the 0.77 template, untouched |
| compileSdk / buildTools | 35 / 35.0.0 | the 0.77 template, untouched |
| newArchEnabled | `true` | the 0.77 template default |

## The result

```
./gradlew assembleDebug
BUILD SUCCESSFUL in 2m 30s
90 actionable tasks: 90 executed
```

Artifacts that make it more than an exit code:

- `android/app/build/outputs/apk/debug/app-debug.apk` — a real 110 MB APK.
- `node_modules/autoskeleton/android/build/tmp/kotlin-classes/debug/com/autoskeleton/AutoskeletonPackage.class`
  — the exact class whose `ReactModuleInfo` call is the Android half of the
  floor argument, compiled.
- `node_modules/autoskeleton/android/build/generated/source/codegen/java/com/facebook/react/viewmanagers/AutoskeletonOverlayViewManagerDelegate.java`
  — codegen ran.
- `npx react-native config` lists `autoskeleton` under `dependencies`, so
  `@react-native-community/cli` autolinking discovers it on 0.77 (ADR-14).

## Running it

```bash
npm install
npm run android          # or: npm run ios
```

`npm run ios` needs `pod install` in `ios/` first. **iOS is not verified here.**
Current Xcode's Clang rejects the `fmt` release that RN 0.77 pins
(`call to consteval function … is not a constant expression`), which is a break
between those two and says nothing about this library. The Android build is what
carries the claim; the iOS half of the floor argument rests on the tarball
evidence above rather than on a local build.
