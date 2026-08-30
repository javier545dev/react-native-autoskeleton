/**
 * Shared chrome for the demo gallery.
 *
 * Deliberately tiny and boring: every pixel of interest in a demo should be
 * the library's, not this file's. Nothing here imports `autoskeleton`.
 *
 * NAMING RULE (load-bearing): no identifier, `testID` or `accessibilityLabel`
 * in `demos/` may start with `paint-gate` or `tier2`. The on-device gates in
 * `android/app/src/androidTest/**` and `ios/AutoskeletonBareRnPaintGateUITests/**`
 * locate their fixtures with exact matches AND prefix matches
 * (`By.descStartsWith("paint-gate-list-real-")`, etc.). Every handle in the
 * gallery is prefixed `demo-` so it can never be mistaken for a gate fixture.
 */

import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

export const DEMO_COLORS = {
  ink: '#0f172a',
  muted: '#64748b',
  line: '#e2e8f0',
  accent: '#2f6fed',
  surface: '#ffffff',
  canvas: '#f8fafc',
  code: '#f1f5f9',
} as const;

/** Standard demo page: a headline, a one-line claim, and the live area. */
export function DemoPage({
  title,
  claim,
  children,
  scroll = true,
}: {
  title: string;
  claim: string;
  children: ReactNode;
  scroll?: boolean;
}): React.JSX.Element {
  const header = (
    <View style={styles.pageHeader}>
      <Text style={styles.pageTitle}>{title}</Text>
      <Text style={styles.pageClaim}>{claim}</Text>
    </View>
  );

  if (!scroll) {
    return (
      <View style={styles.page}>
        {header}
        <View style={styles.pageBodyFlex}>{children}</View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.pageBody}>
      {header}
      {children}
    </ScrollView>
  );
}

/** A labelled panel around one live example. */
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

/** Monospace readout for metrics/cache keys — the numbers a demo claims. */
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
    gap: 16,
    paddingBottom: 48,
  },
  pageBodyFlex: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 16,
  },
  pageHeader: {
    gap: 4,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
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
    gap: 12,
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
});
