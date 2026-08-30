/** Buttons and the fake data source, mirroring `examples/bare-rn/demos/controls.tsx`. */

import { useCallback, useEffect, useState } from 'react';
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

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  testIDPrefix,
}: {
  options: ReadonlyArray<{ readonly value: T; readonly label: string }>;
  value: T;
  onChange: (next: T) => void;
  testIDPrefix: string;
}): React.JSX.Element {
  return (
    <View style={styles.segmented}>
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
