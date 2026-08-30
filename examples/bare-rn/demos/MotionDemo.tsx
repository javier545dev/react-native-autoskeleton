/**
 * DEMO — Animation and reduced motion.
 *
 * `animation` picks shimmer / pulse / none. The interesting part is what
 * happens when you do NOT get to pick: if the OS reports "reduce motion",
 * `shimmer` is downgraded to `pulse` automatically. An app that never thought
 * about the setting still respects it.
 *
 * The readout below is the live value of that OS preference, read through
 * `AccessibilityInfo` and subscribed to, so you can flip it in Settings and
 * watch the shimmer degrade without relaunching:
 *   iOS simulator — Settings › Accessibility › Motion › Reduce Motion
 *   Android emulator — Settings › Accessibility › Remove animations
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { AutoSkeleton } from 'autoskeleton';
import type { AnimationKind } from 'autoskeleton';
import { Segmented } from './controls';
import { DEMO_COLORS, DemoPage, Panel, Readout, Row } from './ui';

const ANIMATIONS = [
  { value: 'shimmer' as const, label: 'shimmer' },
  { value: 'pulse' as const, label: 'pulse' },
  { value: 'none' as const, label: 'none' },
];

function useReduceMotionPreference(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (alive) {
        setEnabled(v);
      }
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setEnabled);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return enabled;
}

export function MotionDemo(): React.JSX.Element {
  const [animation, setAnimation] = useState<AnimationKind>('shimmer');
  const reduceMotion = useReduceMotionPreference();
  const effective: AnimationKind = reduceMotion && animation === 'shimmer' ? 'pulse' : animation;

  return (
    <DemoPage
      title="Motion"
      claim="Shimmer, pulse or nothing — and shimmer degrades to pulse on its own when the OS asks for reduced motion."
    >
      <Row>
        <Segmented
          options={ANIMATIONS}
          value={animation}
          onChange={setAnimation}
          testIDPrefix="demo-motion"
        />
      </Row>
      <Readout>
        {`OS reduce-motion: ${reduceMotion}\nrequested: ${animation}\neffective: ${effective}`}
      </Readout>

      <Panel label={`<AutoSkeleton animation="${animation}">`}>
        <AutoSkeleton isLoading skeletonKey={`demo-motion-${animation}`} animation={animation}>
          <View style={styles.card}>
            <View style={styles.line} />
            <View style={[styles.line, styles.lineShort]} />
            <View style={styles.block} />
          </View>
        </AutoSkeleton>
      </Panel>
    </DemoPage>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 12,
  },
  line: {
    width: '100%',
    height: 20,
    backgroundColor: DEMO_COLORS.ink,
    borderRadius: 4,
  },
  lineShort: {
    width: '65%',
  },
  block: {
    width: '100%',
    height: 96,
    backgroundColor: '#334155',
    borderRadius: 10,
  },
});
