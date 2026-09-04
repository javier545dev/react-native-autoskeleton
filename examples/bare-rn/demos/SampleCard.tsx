/**
 * The piece of ordinary product UI most demos wrap.
 *
 * There is no skeleton markup anywhere in this file, and that is the entire
 * point of the library: you write the loaded state, and the skeleton is
 * derived from the real layout the device measured.
 *
 * The two tag chips carry an OPAQUE background on purpose. The container rule
 * only contributes a shape for a view with a non-transparent background — a
 * transparent sized box is how RN layouts express spacers and gap shims, and
 * painting over those would mean inventing geometry no measurement produced.
 * A translucent chip here would quietly drop two shapes from every skeleton in
 * the gallery. See `docs/image-pipeline.md` §3a for the same rule stated from
 * the other direction.
 */

import { Image, StyleSheet, Text, View } from 'react-native';
import { useDemoTheme } from './theme';

/** Bundled with the app rather than fetched, so a demo never depends on the
 *  simulator having a network. */
const AVATAR = require('../assets/avatar.png');

export function SampleCard(): React.JSX.Element {
  const t = useDemoTheme();
  const chip = t.scheme === 'dark' ? '#1d2b45' : '#dbeafe';

  return (
    <View style={{ gap: t.space.md }}>
      <View style={[styles.headRow, { gap: t.space.md }]}>
        <Image source={AVATAR} style={styles.avatar} />
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
