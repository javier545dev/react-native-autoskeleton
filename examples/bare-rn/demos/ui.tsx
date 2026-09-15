/**
 * Shared chrome for the demo gallery.
 *
 * Deliberately quiet: every pixel of interest in a demo should be the
 * library's, not this file's. Nothing here imports `autoskeleton`. All colour,
 * type and spacing comes from `theme.ts`, whose header carries the five rules
 * this file implements — the important one being that chrome must never paint
 * a borderless filled grey block, because that is exactly what the library
 * paints.
 *
 * NAMING RULE (load-bearing): no identifier, `testID` or `accessibilityLabel`
 * in `demos/` may start with `paint-gate` or `tier2`. The on-device gates in
 * `android/app/src/androidTest/**` and `ios/AutoskeletonBareRnPaintGateUITests/**`
 * locate their fixtures with exact matches AND prefix matches
 * (`By.descStartsWith("paint-gate-list-real-")`, `By.descStartsWith("tier2-renderer:")`,
 * etc.). Every handle in the gallery is prefixed `demo-` so it can never be
 * mistaken for a gate fixture. `registry.ts` does carry a group whose id is
 * the string `tier2`, which is data, never a handle: the section header it
 * renders is `demo-group-tier2`.
 *
 * PAGE ANATOMY, in this order and no other:
 *   kicker (the group)  ·  title  ·  claim  ·  stage  ·  controls  ·  readout
 *   ·  note  ·  source pointer
 * `DemoPage` owns the kicker, the title, the claim and the source pointer;
 * a demo supplies the middle. Consistency here is what lets a reader skim
 * twelve screens without re-learning where the answer is each time.
 */

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useDemoTheme } from './theme';

/** What the gallery knows about the demo that a demo file does not know about
 *  itself: which group it was filed under, and where its source lives. Passed
 *  by context rather than by prop so twelve demo files do not each have to
 *  restate what `registry.ts` already says. */
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

/** Standard demo page: kicker, title, claim, the demo, and a source pointer. */
export function DemoPage({
  title,
  claim,
  children,
  scroll = true,
}: {
  readonly title: string;
  readonly claim: string;
  readonly children: ReactNode;
  /** `false` for a demo that hosts its own virtualized list and therefore
   *  needs the page height rather than a scrolling content box. */
  readonly scroll?: boolean;
}): React.JSX.Element {
  const t = useDemoTheme();
  const meta = useContext(DemoMetaContext);

  const header = (
    <View style={{ gap: t.space.xs }}>
      {meta === null ? null : (
        <Text style={[t.type.caption, styles.kicker, { color: t.color.faint }]}>
          {meta.kicker.toUpperCase()}
        </Text>
      )}
      <Text style={[t.type.title, { color: t.color.ink }]}>{title}</Text>
      <Text style={[t.type.body, { color: t.color.muted }]}>{claim}</Text>
    </View>
  );

  const source = meta === null ? null : <SourcePointer source={meta.source} />;

  if (!scroll) {
    return (
      <View style={[styles.page, { backgroundColor: t.color.canvas }]}>
        <View style={{ paddingHorizontal: t.space.lg, paddingTop: t.space.lg }}>{header}</View>
        <View style={[styles.flexBody, { paddingHorizontal: t.space.lg, gap: t.space.lg }]}>
          {children}
        </View>
        <View
          style={{
            paddingHorizontal: t.space.lg,
            paddingBottom: t.space.lg,
            paddingTop: t.space.sm,
          }}
        >
          {source}
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.page, { backgroundColor: t.color.canvas }]}
      contentContainerStyle={{ padding: t.space.lg, gap: t.space.lg, paddingBottom: t.space.xxl }}
    >
      {header}
      {children}
      {source}
    </ScrollView>
  );
}

/**
 * The STAGE: one live example, inside a bordered panel labelled with the API
 * it demonstrates.
 *
 * The border and the `live` tag are the whole point. Everything inside this
 * frame may be the library's output; everything outside it is this app. A
 * screenshot of one panel is self-explanatory without the surrounding page,
 * which is what makes these demos usable in an issue report.
 */
export function Panel({
  label,
  note,
  live = true,
  children,
}: {
  readonly label: string;
  readonly note?: string;
  /** `false` for a panel that carries prose rather than a running example, so
   *  the tag never claims something is live when nothing is. */
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
      <View style={[styles.panelHead, { gap: t.space.md }]}>
        <Text style={[t.type.heading, styles.panelLabel, { color: t.color.ink }]}>{label}</Text>
        {live ? (
          <Text style={[t.type.caption, styles.tag, { color: t.color.faint }]}>LIVE</Text>
        ) : null}
      </View>
      {note === undefined ? null : (
        <Text style={[t.type.caption, styles.panelNote, { color: t.color.muted }]}>{note}</Text>
      )}
      {children}
    </View>
  );
}

/** Monospace readout for the numbers a demo claims. */
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

/** A readout with a real label column, for payloads rather than one-liners.
 *  The label column is `faint` so the eye lands on the values, which are the
 *  part that changes. */
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
          <Text style={[t.type.code, styles.readoutValue, { fontFamily: t.mono, color: t.color.ink }]}>
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

/** Small print inside a panel — captions under a control, footnotes. */
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

/** A row of controls. Wraps, so a narrow screen never clips a button. */
export function Row({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const t = useDemoTheme();
  return <View style={[styles.row, { gap: t.space.sm }]}>{children}</View>;
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  flexBody: {
    flex: 1,
  },
  kicker: {
    letterSpacing: 0.8,
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  panelNote: {
    lineHeight: 17,
  },
  panelLabel: {
    flex: 1,
  },
  tag: {
    letterSpacing: 0.8,
  },
  readoutRow: {
    flexDirection: 'row',
  },
  readoutLabel: {
    width: 132,
  },
  readoutValue: {
    flex: 1,
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
