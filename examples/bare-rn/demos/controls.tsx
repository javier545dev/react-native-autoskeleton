/**
 * Interactive controls and the fake data source every demo loads from.
 *
 * `useFakeLoad` is the whole "network" of this gallery: a timer that flips
 * `isLoading` to false after `ms`. Real enough to make the skeleton -> content
 * transition genuine, small enough that no demo is really about it.
 *
 * The controls are bordered, never filled grey, and their labels are
 * monospaced: a control that says `delay={400}` is quoting an API, and quoting
 * it in the same face as the readouts is what keeps the prop, the button and
 * the measured result legible as one thing. See `theme.ts` for the rest.
 *
 * NOT shared with `examples/expo/demos/controls.tsx`, deliberately — see that
 * file's header for what is shared and what is not.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useDemoTheme } from './theme';

export function Button({
  label,
  onPress,
  testID,
  tone = 'accent',
  disabled = false,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly testID?: string;
  readonly tone?: 'accent' | 'quiet';
  /** Rendered visibly inert rather than hidden. A control that cannot work on
   *  this platform is information; removing it is not. */
  readonly disabled?: boolean;
}): React.JSX.Element {
  const t = useDemoTheme();
  const accent = tone === 'accent' && !disabled;

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={testID}
      accessibilityState={{ disabled }}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={[
        disabled ? styles.inert : null,
        {
          paddingHorizontal: t.space.lg,
          paddingVertical: t.space.md,
          borderRadius: t.radius.md,
          borderWidth: t.border.panel,
          borderColor: accent ? t.color.accent : t.color.lineStrong,
          backgroundColor: accent ? t.color.accent : t.color.surface,
        },
      ]}
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

/** A one-of-N picker. Used for `animation`, radius values, and so on. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  testIDPrefix,
}: {
  readonly options: ReadonlyArray<{ readonly value: T; readonly label: string }>;
  readonly value: T;
  readonly onChange: (next: T) => void;
  readonly testIDPrefix?: string;
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
            key={String(option.value)}
            accessible
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={testIDPrefix === undefined ? undefined : `${testIDPrefix}-${option.value}`}
            testID={testIDPrefix === undefined ? undefined : `${testIDPrefix}-${option.value}`}
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
  /** Restarts the SAME instance's load — the stale-while-revalidate path. */
  readonly reload: () => void;
  /** Ends the load immediately, without waiting the timer out. */
  readonly reveal: () => void;
  /** Bumps a React `key`, so the consumer can remount and get a genuinely
   *  cold instance again (REQ-PTR-1 suppression is per-instance state). */
  readonly coldKey: number;
  readonly reloadCold: () => void;
}

export function useFakeLoad(ms: number, options?: { readonly autoStart?: boolean }): FakeLoad {
  const [isLoading, setIsLoading] = useState(options?.autoStart ?? true);
  const [coldKey, setColdKey] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isLoading) {
      return;
    }
    timer.current = setTimeout(() => setIsLoading(false), ms);
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    };
  }, [isLoading, ms]);

  const reload = useCallback(() => setIsLoading(true), []);
  const reveal = useCallback(() => setIsLoading(false), []);
  const reloadCold = useCallback(() => {
    setColdKey((k) => k + 1);
    setIsLoading(true);
  }, []);

  return { isLoading, reload, reveal, coldKey, reloadCold };
}

const styles = StyleSheet.create({
  inert: {
    opacity: 0.55,
  },
  segmented: {
    flexDirection: 'row',
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
});
