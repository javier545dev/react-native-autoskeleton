#!/usr/bin/env node
// scripts/adopt-template-toolchain.mjs
//
// Copies the `ext { ... }` block of one Android `build.gradle` over another's.
//
// WHY THIS EXISTS. `native-matrix.yml` builds `examples/bare-rn` once per
// supported React Native version. Pinning that row's JavaScript dependencies
// down does NOT make it an app of that version: the checked-in
// `android/build.gradle` still carries the newest release's native toolchain,
// and React Native's own `react-native-gradle-plugin` will not compile under a
// toolchain from a much later release.
//
// The first attempt at this pinned two values, Kotlin and the Gradle wrapper.
// The rows then failed one knob further along, on
// `Failed to find Platform SDK with path: platforms;android-37`, because the
// same block also carries `buildToolsVersion`, `compileSdkVersion`,
// `targetSdkVersion`, `ndkVersion` and `minSdkVersion`. Enumerating pins loses
// that race one value at a time and silently rots when a future release adds a
// knob nobody here knows about.
//
// So this takes the WHOLE block from the `@react-native-community/template`
// tarball of that exact release — the source of truth for what an app of that
// version actually ships — and cannot miss a value it does not know about.
//
// It lives in a file rather than inline in the workflow because an indented
// heredoc inside a YAML `run: |` block hands Python and Node a body whose
// every line is indented, which is a syntax error. That was found by running
// it, not by reading it.
//
// Usage: node scripts/adopt-template-toolchain.mjs <source.gradle> <target.gradle>

import { readFileSync, writeFileSync } from 'node:fs';

/** Matches `ext {` through the closing brace at the same indentation.
 *  Deliberately anchored on the four-space `    }` the React Native template
 *  has always used, so a stray `}` inside the block cannot end the match. */
const EXT_BLOCK = /ext \{[\s\S]*?\n {4}\}/;

export function spliceExtBlock(sourceGradle, targetGradle) {
  const wanted = EXT_BLOCK.exec(sourceGradle);
  if (wanted === null) {
    throw new Error('no `ext { ... }` block found in the template build.gradle');
  }
  const present = EXT_BLOCK.exec(targetGradle);
  if (present === null) {
    throw new Error('no `ext { ... }` block found in the target build.gradle');
  }
  return (
    targetGradle.slice(0, present.index) +
    wanted[0] +
    targetGradle.slice(present.index + present[0].length)
  );
}

// Only run when invoked directly, so the test can import the pure function.
if (process.argv[1] && process.argv[1].endsWith('adopt-template-toolchain.mjs')) {
  const [source, target] = process.argv.slice(2);
  if (!source || !target) {
    console.error('usage: adopt-template-toolchain.mjs <source.gradle> <target.gradle>');
    process.exit(2);
  }
  const merged = spliceExtBlock(readFileSync(source, 'utf8'), readFileSync(target, 'utf8'));
  writeFileSync(target, merged);
  console.log(EXT_BLOCK.exec(merged)[0]);
}
