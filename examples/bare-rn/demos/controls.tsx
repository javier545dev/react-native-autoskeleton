/**
 * Interactive controls and the fake data source every demo loads from.
 *
 * `useFakeLoad` is the whole "network" of this gallery: a timer that flips
 * `isLoading` to false after `ms`. Real enough to make the skeleton -> content
 * transition genuine, small enough that no demo is really about it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DEMO_COLORS } from './ui';

export function Button({
  label,
  onPress,
  testID,
  tone = 'accent',
}: {
  label: string;
  onPress: () => void;
  testID?: string;
  tone?: 'accent' | 'quiet';
}): React.JSX.Element {
  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={testID}
      testID={testID}
      onPress={onPress}
      style={[styles.button, tone === 'quiet' ? styles.buttonQuiet : styles.buttonAccent]}
    >
      <Text style={tone === 'quiet' ? styles.buttonQuietLabel : styles.buttonAccentLabel}>{label}</Text>
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
  options: ReadonlyArray<{ readonly value: T; readonly label: string }>;
  value: T;
  onChange: (next: T) => void;
  testIDPrefix?: string;
}): React.JSX.Element {
  return (
    <View style={styles.segmented}>
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
            style={[styles.segment, selected ? styles.segmentSelected : null]}
          >
            <Text style={[styles.segmentLabel, selected ? styles.segmentLabelSelected : null]}>
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
  button: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
  },
  buttonAccent: {
    backgroundColor: DEMO_COLORS.accent,
  },
  buttonQuiet: {
    backgroundColor: DEMO_COLORS.surface,
    borderWidth: 1,
    borderColor: DEMO_COLORS.line,
  },
  buttonAccentLabel: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 13,
  },
  buttonQuietLabel: {
    color: DEMO_COLORS.ink,
    fontWeight: '600',
    fontSize: 13,
  },
  segmented: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: DEMO_COLORS.line,
    borderRadius: 8,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  segment: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: DEMO_COLORS.surface,
  },
  segmentSelected: {
    backgroundColor: DEMO_COLORS.accent,
  },
  segmentLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: DEMO_COLORS.ink,
  },
  segmentLabelSelected: {
    color: '#ffffff',
  },
});
