/**
 * The piece of ordinary product UI the gallery's home hero wraps.
 *
 * There is no skeleton markup anywhere in this file, and that is the entire
 * point of the library: you write the loaded state, and the skeleton is
 * derived from the real layout the device measured.
 *
 * No `<Image>` here, unlike the bare-rn twin: `examples/expo/assets` ships the
 * app icons and the one product photo the image-pipeline demo needs, and this
 * card exists to show the skeleton, not to add a bundled asset. The avatar is
 * therefore a plain opaque circle.
 *
 * Every filled box in here carries an OPAQUE background on purpose. The
 * container rule only contributes a shape for a view with a non-transparent
 * background — a transparent sized box is how RN layouts express spacers and
 * gap shims, and painting over those would mean inventing geometry no
 * measurement produced. See `docs/image-pipeline.md` §3a.
 *
 * None of these colours is `#ff00ff`, `#00ff00` or `#0000ff`; see the colour
 * rule in `ui.tsx`.
 */

import { StyleSheet, Text, View } from 'react-native';
import { useDemoTheme } from './theme';

export function SampleCard(): React.JSX.Element {
  const t = useDemoTheme();
  const chip = t.scheme === 'dark' ? '#1d2b45' : '#dbeafe';

  return (
    <View style={{ gap: t.space.md }}>
      <View style={[styles.headRow, { gap: t.space.md }]}>
        <View style={[styles.avatar, { backgroundColor: t.color.accent }]} />
        <View style={[styles.headText, { gap: t.space.xs }]}>
          <Text style={[styles.title, { color: t.color.ink }]}>Ada Lovelace</Text>
          <Text style={[t.type.label, { color: t.color.muted }]}>Analytical Engine</Text>
        </View>
      </View>
      <Text style={[t.type.body, { color: t.color.ink }]}>
        The Analytical Engine weaves algebraic patterns just as the Jacquard loom weaves flowers and
        leaves.
      </Text>
      <View style={[styles.tagRow, { gap: t.space.sm }]}>
        <View style={[styles.tag, { backgroundColor: chip }]} />
        <View style={[styles.tag, { backgroundColor: chip }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  headText: {
    flex: 1,
  },
  title: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '700',
  },
  tagRow: {
    flexDirection: 'row',
  },
  tag: {
    width: 72,
    height: 26,
    borderRadius: 13,
  },
});
