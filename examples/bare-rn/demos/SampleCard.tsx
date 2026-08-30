/**
 * The piece of ordinary product UI most demos wrap.
 *
 * There is no skeleton markup anywhere in this file, and that is the entire
 * point of the library: you write the loaded state, and the skeleton is
 * derived from the real layout the device measured.
 */

import { Image, StyleSheet, Text, View } from 'react-native';
import { DEMO_COLORS } from './ui';

/** Bundled with the app rather than fetched, so a demo never depends on the
 *  simulator having a network. */
const AVATAR = require('../assets/avatar.png');

export function SampleCard(): React.JSX.Element {
  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Image source={AVATAR} style={styles.avatar} />
        <View style={styles.headText}>
          <Text style={styles.title}>Ada Lovelace</Text>
          <Text style={styles.subtitle}>Analytical Engine</Text>
        </View>
      </View>
      <Text style={styles.body}>
        The Analytical Engine weaves algebraic patterns just as the Jacquard loom weaves flowers and
        leaves.
      </Text>
      <View style={styles.tagRow}>
        <View style={styles.tag} />
        <View style={styles.tag} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 12,
  },
  headRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  headText: {
    gap: 6,
    flex: 1,
  },
  title: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '700',
    color: DEMO_COLORS.ink,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 20,
    color: DEMO_COLORS.muted,
  },
  body: {
    fontSize: 14,
    lineHeight: 22,
    color: DEMO_COLORS.ink,
  },
  tagRow: {
    flexDirection: 'row',
    gap: 8,
  },
  tag: {
    width: 72,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#dbeafe',
  },
});
