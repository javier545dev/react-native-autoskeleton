/**
 * Shared chrome for the Expo demo gallery.
 *
 * COLOUR RULE (load-bearing): nothing in `demos/` may paint the exact colours
 * `#ff00ff`, `#00ff00` or `#0000ff`. `scripts/uniwind-paint-gate.mjs` finds
 * its fixture in a raw device framebuffer by EXACT colour match and derives
 * the sample point from the matching pixels' bounding box, so a second region
 * in any of those three colours would silently widen the box and move the
 * sample off the target. The palette below is deliberately nowhere near them.
 */

import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

export const DEMO_COLORS = {
  ink: '#0f172a',
  muted: '#64748b',
  line: '#e2e8f0',
  accent: '#2563eb',
  surface: '#ffffff',
  canvas: '#f8fafc',
  code: '#f1f5f9',
} as const;

export function DemoPage({
  title,
  claim,
  children,
}: {
  title: string;
  claim: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.pageBody}>
      <Text style={styles.pageTitle}>{title}</Text>
      <Text style={styles.pageClaim}>{claim}</Text>
      {children}
    </ScrollView>
  );
}

export function Panel({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelLabel}>{label}</Text>
      {note === undefined ? null : <Text style={styles.panelNote}>{note}</Text>}
      {children}
    </View>
  );
}

export function Readout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <View style={styles.readout}>
      <Text style={styles.readoutText}>{children}</Text>
    </View>
  );
}

export function Row({ children }: { children: ReactNode }): React.JSX.Element {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: DEMO_COLORS.canvas,
  },
  pageBody: {
    padding: 16,
    gap: 14,
    paddingBottom: 48,
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: DEMO_COLORS.ink,
  },
  pageClaim: {
    fontSize: 13,
    lineHeight: 18,
    color: DEMO_COLORS.muted,
  },
  panel: {
    backgroundColor: DEMO_COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: DEMO_COLORS.line,
    padding: 12,
    gap: 10,
  },
  panelLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: DEMO_COLORS.ink,
  },
  panelNote: {
    fontSize: 12,
    lineHeight: 17,
    color: DEMO_COLORS.muted,
  },
  readout: {
    backgroundColor: DEMO_COLORS.code,
    borderRadius: 8,
    padding: 8,
  },
  readoutText: {
    fontFamily: 'Courier',
    fontSize: 11,
    lineHeight: 16,
    color: DEMO_COLORS.ink,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
});
