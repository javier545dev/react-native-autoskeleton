/**
 * Buttons, a one-of-N picker, and the fake data source this app's demos load
 * from.
 *
 * WHAT IS SHARED WITH `examples/bare-rn/demos` AND WHAT IS NOT.
 * Exactly two files are shared, and they are shared by being BYTE-IDENTICAL
 * copies rather than by a common folder: `demos/theme.ts` (colour, type,
 * spacing, radii, `useDemoTheme`) and `demos/nav.tsx` (the route stack, the
 * nav bar, the Android back handler). `diff` between the two copies of either
 * must print nothing. They are copied instead of extracted because the two
 * apps keep separate lockfiles, run different React Native versions (0.86.3
 * here, 0.87.1 there) and are installed independently in CI from a packed
 * tarball; a shared folder would need `metro.config` `watchFolders` surgery in
 * both and would undermine the tarball-install realism that is the point of
 * these examples.
 *
 * This file and `ui.tsx` are deliberately NOT shared, and the header of each
 * says why in its own terms: `ui.tsx` carries a colour rule that only exists
 * because of this app's framebuffer gate, and this file's controls are a
 * strict subset of the bare-rn set — three demos need fewer affordances than
 * twelve do, and `useFakeLoad` here has no `reload` (the stale-while-revalidate
 * path is demonstrated in `examples/bare-rn/demos/RefreshDemo.tsx`, which is
 * the app that owns that story). Both are built on the shared tokens, which
 * removes the drift that actually mattered.
 *
 * The previous version of this line claimed the file mirrored
 * `examples/bare-rn/demos/controls.tsx`. It never did — the two had different
 * prop shapes, a different `FakeLoad` interface and different colours — and a
 * comment that says "these are the same" about two files that are not is worse
 * than no comment at all.
 */

import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useDemoTheme } from './theme';

export function Button({
  label,
  onPress,
  testID,
  tone = 'accent',
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly testID?: string;
  readonly tone?: 'accent' | 'quiet';
}): React.JSX.Element {
  const t = useDemoTheme();
  const accent = tone === 'accent';

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={testID}
      testID={testID}
      onPress={onPress}
      style={{
        paddingHorizontal: t.space.lg,
        paddingVertical: t.space.md,
        borderRadius: t.radius.md,
        borderWidth: t.border.panel,
        borderColor: accent ? t.color.accent : t.color.lineStrong,
        backgroundColor: accent ? t.color.accent : t.color.surface,
      }}
    >
      <Text
        style={[
          t.type.label,
          { fontFamily: t.mono, color: accent ? t.color.accentInk : t.color.ink },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  testIDPrefix,
}: {
  readonly options: ReadonlyArray<{ readonly value: T; readonly label: string }>;
  readonly value: T;
  readonly onChange: (next: T) => void;
  readonly testIDPrefix: string;
}): React.JSX.Element {
  const t = useDemoTheme();

  return (
    <View
      style={[
        styles.segmented,
        {
          borderWidth: t.border.panel,
          borderColor: t.color.lineStrong,
          borderRadius: t.radius.sm,
          backgroundColor: t.color.surface,
        },
      ]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessible
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${testIDPrefix}-${option.value}`}
            testID={`${testIDPrefix}-${option.value}`}
            onPress={() => onChange(option.value)}
            style={{
              paddingHorizontal: t.space.md,
              paddingVertical: t.space.sm,
              backgroundColor: selected ? t.color.accentSoft : t.color.surface,
            }}
          >
            <Text
              style={[
                t.type.label,
                { fontFamily: t.mono, color: selected ? t.color.accent : t.color.muted },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export interface FakeLoad {
  readonly isLoading: boolean;
  readonly reveal: () => void;
  readonly coldKey: number;
  readonly reloadCold: () => void;
}

export function useFakeLoad(ms: number): FakeLoad {
  const [isLoading, setIsLoading] = useState(true);
  const [coldKey, setColdKey] = useState(0);

  useEffect(() => {
    if (!isLoading) {
      return;
    }
    const id = setTimeout(() => setIsLoading(false), ms);
    return () => clearTimeout(id);
  }, [isLoading, ms, coldKey]);

  const reveal = useCallback(() => setIsLoading(false), []);
  const reloadCold = useCallback(() => {
    setColdKey((k) => k + 1);
    setIsLoading(true);
  }, []);

  return { isLoading, reveal, coldKey, reloadCold };
}

const styles = StyleSheet.create({
  segmented: {
    flexDirection: 'row',
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
});
