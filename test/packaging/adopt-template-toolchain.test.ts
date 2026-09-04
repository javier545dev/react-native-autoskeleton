import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs helper, no types, imported for its pure function
import { spliceExtBlock } from '../../scripts/adopt-template-toolchain.mjs';

// `native-matrix.yml` builds `examples/bare-rn` once per supported React Native
// version. Swapping that row's JavaScript dependencies down does not make it an
// app of that version — `android/build.gradle` keeps the newest release's
// native toolchain, and React Native's own gradle plugin will not compile under
// one from far in the future.
//
// The first fix pinned two values (Kotlin, Gradle) and the rows failed one knob
// later on `Failed to find Platform SDK android-37`, because the same block
// carries buildTools, compileSdk, targetSdk, ndk and minSdk too. So the helper
// under test lifts the WHOLE `ext { }` block from that release's own template.
//
// The interesting property is not "it copies text" — it is that it copies
// EVERY knob including ones this test does not name, and changes nothing else.

const TEMPLATE_077 = `buildscript {
    ext {
        buildToolsVersion = "35.0.0"
        minSdkVersion = 24
        compileSdkVersion = 35
        targetSdkVersion = 34
        ndkVersion = "27.1.12297006"
        kotlinVersion = "2.0.21"
    }
    repositories {
        google()
    }
}
`;

const EXAMPLE_087 = `buildscript {
    ext {
        buildToolsVersion = "37.0.0"
        minSdkVersion = 24
        compileSdkVersion = 37
        targetSdkVersion = 36
        ndkVersion = "27.1.12297006"
        kotlinVersion = "2.2.0"
    }
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.facebook.react:react-native-gradle-plugin")
    }
}

apply plugin: "com.facebook.react.rootproject"
`;

describe('adopt-template-toolchain', () => {
  const merged = spliceExtBlock(TEMPLATE_077, EXAMPLE_087) as string;

  it('takes every knob from the template, not a chosen few', () => {
    // compileSdkVersion is the one that produced
    // "Failed to find Platform SDK with path: platforms;android-37" after a fix
    // that pinned only Kotlin and Gradle. It must come across too.
    expect(merged).toContain('compileSdkVersion = 35');
    expect(merged).toContain('buildToolsVersion = "35.0.0"');
    expect(merged).toContain('targetSdkVersion = 34');
    expect(merged).toContain('kotlinVersion = "2.0.21"');
    expect(merged).not.toContain('37.0.0');
    expect(merged).not.toContain('compileSdkVersion = 37');
    expect(merged).not.toContain('kotlinVersion = "2.2.0"');
  });

  it('leaves everything outside the ext block alone', () => {
    // The example carries repositories, a classpath and a root-project plugin
    // the bare template does not. Losing them would break the build in a way
    // that looks like a toolchain problem.
    expect(merged).toContain('mavenCentral()');
    expect(merged).toContain('com.facebook.react:react-native-gradle-plugin');
    expect(merged).toContain('apply plugin: "com.facebook.react.rootproject"');
  });

  it('refuses rather than guesses when either side has no ext block', () => {
    // A silent no-op here would leave the row building the wrong toolchain
    // while reporting success, which is the failure mode this whole step exists
    // to remove.
    expect(() => spliceExtBlock('buildscript { }', EXAMPLE_087)).toThrow(/template/);
    expect(() => spliceExtBlock(TEMPLATE_077, 'buildscript { }')).toThrow(/target/);
  });
});
