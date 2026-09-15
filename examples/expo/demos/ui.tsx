/**
 * Shared chrome for the Expo demo gallery.
 *
 * COLOUR RULE (load-bearing): nothing in `demos/` may paint the exact colours
 * `#ff00ff`, `#00ff00` or `#0000ff`. `scripts/uniwind-paint-gate.mjs` finds
 * its fixture in a raw device framebuffer by EXACT colour match and derives
 * the sample point from the matching pixels' bounding box, so a second region
 * in any of those three colours would silently widen the box and move the
 * sample off the target. The palettes in `theme.ts` are deliberately nowhere
 * near them, and that file's header restates this rule for whoever adds the
 * next colour.
 *
 * Everything visual comes from `theme.ts`, whose header carries the five rules
 * this file implements — the load-bearing one being that chrome must never
 * paint a borderless filled grey block, because that is exactly what the
 * library paints. Nothing here imports `autoskeleton`.
 *
 * PAGE ANATOMY, in this order and no other:
 *   kicker (the group)  ·  title  ·  claim  ·  stage  ·  controls  ·  readout
 *   ·  note  ·  source pointer
 */

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useDemoTheme } from './theme';

/** What the gallery knows about a demo that the demo file does not know about
 *  itself: its group, and where its source lives. Passed by context so a demo
 *  file never restates what `registry.ts` already says. */
export interface DemoMeta {
  readonly kicker: string;
  readonly source: string;
}

const DemoMetaContext = createContext<DemoMeta | null>(null);

export function DemoMetaProvider({
  meta,
  children,
}: {
  readonly meta: DemoMeta;
  readonly children: ReactNode;
}): React.JSX.Element {
  return <DemoMetaContext.Provider value={meta}>{children}</DemoMetaContext.Provider>;
}

export function DemoPage({
  title,
  claim,
  children,
}: {
  readonly title: string;
  readonly claim: string;
  readonly children: ReactNode;
}): React.JSX.Element {
  const t = useDemoTheme();
  const meta = useContext(DemoMetaContext);

  return (
    <ScrollView
      style={[styles.page, { backgroundColor: t.color.canvas }]}
      contentContainerStyle={{ padding: t.space.lg, gap: t.space.lg, paddingBottom: t.space.xxl }}
    >
      <View style={{ gap: t.space.xs }}>
        {meta === null ? null : (
          <Text style={[t.type.caption, styles.kicker, { color: t.color.faint }]}>
            {meta.kicker.toUpperCase()}
          </Text>
        )}
        <Text style={[t.type.title, { color: t.color.ink }]}>{title}</Text>
        <Text style={[t.type.body, { color: t.color.muted }]}>{claim}</Text>
      </View>
      {children}
      {meta === null ? null : <SourcePointer source={meta.source} />}
    </ScrollView>
  );
}

/**
 * The STAGE: one live example inside a bordered panel labelled with the API it
 * demonstrates. The border and the `LIVE` tag are the point — everything
 * inside the frame may be the library's output, everything outside it is this
 * app, and a screenshot of one panel is self-explanatory without the page
 * around it.
 */
export function Panel({
  label,
  note,
  live = true,
  children,
}: {
  readonly label: string;
  readonly note?: string;
  readonly live?: boolean;
  readonly children: ReactNode;
}): React.JSX.Element {
  const t = useDemoTheme();

  return (
    <View
      style={{
        backgroundColor: t.color.stage,
        borderColor: t.color.line,
        borderWidth: t.border.panel,
        borderRadius: t.radius.lg,
        padding: t.space.lg,
        gap: t.space.md,
      }}
    >
      <View style={styles.panelHead}>
        <Text style={[t.type.heading, styles.grow, { color: t.color.ink }]}>{label}</Text>
        {live ? (
          <Text style={[t.type.caption, styles.tag, { color: t.color.faint }]}>LIVE</Text>
        ) : null}
      </View>
      {note === undefined ? null : (
        <Text style={[t.type.caption, styles.note, { color: t.color.muted }]}>{note}</Text>
      )}
      {children}
    </View>
  );
}

export function Readout({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const t = useDemoTheme();
  return (
    <View
      style={{ backgroundColor: t.color.codeBg, borderRadius: t.radius.md, padding: t.space.md }}
    >
      <Text style={[t.type.code, { fontFamily: t.mono, color: t.color.ink }]}>{children}</Text>
    </View>
  );
}

/** A readout with a real label column — `faint`, so the eye lands on the
 *  values, which are the part that changes. */
export function ReadoutRows({
  rows,
}: {
  readonly rows: ReadonlyArray<readonly [string, string]>;
}): React.JSX.Element {
  const t = useDemoTheme();
  return (
    <View
      style={{
        backgroundColor: t.color.codeBg,
        borderRadius: t.radius.md,
        padding: t.space.md,
        gap: t.space.xs,
      }}
    >
      {rows.map(([label, value]) => (
        <View key={label} style={[styles.readoutRow, { gap: t.space.sm }]}>
          <Text style={[t.type.code, styles.readoutLabel, { fontFamily: t.mono, color: t.color.faint }]}>
            {label}
          </Text>
          <Text style={[t.type.code, styles.grow, { fontFamily: t.mono, color: t.color.ink }]}>
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Prose that qualifies what you just saw. */
export function Note({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const t = useDemoTheme();
  return <Text style={[t.type.body, { color: t.color.muted }]}>{children}</Text>;
}

/** Small print inside a panel. */
export function Caption({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const t = useDemoTheme();
  return <Text style={[t.type.caption, { color: t.color.muted }]}>{children}</Text>;
}

/** The last line of every demo: where to read the code that made it. */
export function SourcePointer({ source }: { readonly source: string }): React.JSX.Element {
  const t = useDemoTheme();
  return (
    <View style={[styles.sourceRow, { gap: t.space.sm }]}>
      <Text style={[t.type.caption, { color: t.color.faint }]}>source</Text>
      <Text style={[t.type.caption, { fontFamily: t.mono, color: t.color.muted }]}>{source}</Text>
    </View>
  );
}

export function Row({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const t = useDemoTheme();
  return <View style={[styles.row, { gap: t.space.sm }]}>{children}</View>;
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  kicker: {
    letterSpacing: 0.8,
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  note: {
    lineHeight: 17,
  },
  tag: {
    letterSpacing: 0.8,
  },
  grow: {
    flex: 1,
  },
  readoutRow: {
    flexDirection: 'row',
  },
  readoutLabel: {
    width: 132,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
});
