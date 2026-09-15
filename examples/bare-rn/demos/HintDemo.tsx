/**
 * DEMO — `<AutoSkeleton.Hint radius>`.
 *
 * Why this exists at all is a measured platform limitation, not an API taste
 * decision (brief §9c): on Android NO public API recovers the corner radius of
 * a rounded React Native view. `Outline.getRadius()` returns
 * RADIUS_UNDEFINED in exactly the rounded case. So on Android the typed hint
 * is the PRIMARY radius mechanism, not a fallback.
 *
 * On iOS `layer.cornerRadius` is directly readable, so the hint OVERRIDES the
 * measured value there instead of filling a gap — deliberately, so one prop
 * behaves the same way on both platforms rather than silently doing nothing
 * on one of them.
 *
 * Three identical 96x96 squares. None of them has a `borderRadius` style: the
 * hint is the only source of roundedness, which is what makes the difference
 * legible.
 */

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AutoSkeleton } from 'autoskeleton';
import { Button, Segmented } from './controls';
import { Caption, DemoPage, Panel, Row } from './ui';

const RADII = [
  { value: 0, label: '0' },
  { value: 12, label: '12' },
  { value: 24, label: '24' },
  { value: 48, label: '48 (circle)' },
] as const;

export function HintDemo(): React.JSX.Element {
  // This demo is about the SHAPE the skeleton paints, so `isLoading` is held
  // under manual control instead of on a timer.
  const [isLoading, setIsLoading] = useState(true);
  const [cycle, setCycle] = useState(0);
  const [radius, setRadius] = useState<number>(24);

  return (
    <DemoPage
      title="Radius hint"
      claim="A square view, no borderRadius anywhere — the rounded skeleton corner comes only from <AutoSkeleton.Hint radius>."
    >
      <Row>
        <Segmented options={RADII} value={radius} onChange={setRadius} testIDPrefix="demo-hint-radius" />
      </Row>

      <Panel
        label="hinted vs unhinted, same frame"
        note="Left carries the hint and re-keys when you change it. Right is the identical square with no hint at all."
      >
        <View style={styles.row}>
          <View style={styles.cell}>
            <AutoSkeleton
              key={`hinted-${radius}-${cycle}`}
              isLoading={isLoading}
              skeletonKey={`demo-hint-${radius}`}
            >
              <AutoSkeleton.Hint id="demo-hint-square" radius={radius}>
                <View style={styles.square} />
              </AutoSkeleton.Hint>
            </AutoSkeleton>
            <Caption>{`radius=${radius}`}</Caption>
          </View>

          <View style={styles.cell}>
            <AutoSkeleton key={`plain-${cycle}`} isLoading={isLoading} skeletonKey="demo-hint-none">
              <View style={styles.square} />
            </AutoSkeleton>
            <Caption>no hint</Caption>
          </View>
        </View>
      </Panel>

      <Row>
        <Button
          label={isLoading ? 'Reveal content' : 'Show skeleton again'}
          testID="demo-hint-toggle"
          tone="quiet"
          onPress={() => {
            if (isLoading) {
              setIsLoading(false);
              return;
            }
            setCycle((c) => c + 1);
            setIsLoading(true);
          }}
        />
      </Row>
    </DemoPage>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 24,
  },
  cell: {
    gap: 6,
    alignItems: 'center',
  },
  square: {
    // Opaque and saturated on purpose: the container rule only emits a shape
    // for a view with a non-transparent background, and this square IS the
    // shape the hint is rounding.
    width: 96,
    height: 96,
    backgroundColor: '#f59e0b',
  },
});
