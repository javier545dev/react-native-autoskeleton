/**
 * DEMO — leaf frames are clipped to their scrolling ancestors.
 *
 * Both native sensors used to account for a scroll offset and then measure the
 * child at FULL size, so everything past the fold became shapes nobody can
 * see. The cost was never mainly paint: those shapes are charged against
 * `maxShapes`, so a long list could spend its whole budget below the fold and
 * truncate the part actually on screen. Fixed in `AutoskeletonSensor.swift`
 * and `AutoskeletonSensor.kt`; web already did this through
 * `computeClipBox`/`applyClip`.
 *
 * The two panels below hold the SAME rows at the SAME visible height. Only
 * the container differs:
 *
 *   first   — a <ScrollView>, 168 pt tall. Clipped; off-screen rows cost nothing.
 *   second  — a <View>, 168 pt tall, overflow:'hidden'. NOT clipped; every row
 *             is charged.
 *
 * That asymmetry is deliberate, not an oversight. Clipping against every
 * parent that crops its children would be a much larger behavioural change —
 * a child overflowing its parent is ordinary in a React Native layout — and
 * the scrolling case is the one with a symptom a user notices. Stated in the
 * sensors and in `docs/platform-support.md` §5e.
 *
 * NOTHING VISIBLE SEPARATES THESE TWO PANELS, and that is the point: the cost
 * was invisible, which is why it survived. The evidence is `onMetrics`.
 *
 * MEASURED ON DEVICE (iPhone 17, iOS 26.5 simulator, 2026-09-02):
 *   scrolling container  shapeCount: 6
 *   plain container      shapeCount: 24
 * Twelve rows of two opaque leaves each. Three 56 pt rows fill the 168 pt
 * viewport exactly, so the fourth begins at the fold, intersects the viewport
 * to zero area, and is dropped by the degenerate-frame guard along with the
 * eight below it. Four times the geometry for the same picture.
 *
 * Geometry is cached per composite key, so each panel reports the count
 * measured on the first cold run of its key. Scrolling the first panel and
 * loading again does not re-measure it — the cache key has no scroll segment.
 */

import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AutoSkeleton } from 'autoskeleton';
import type { SkeletonMetrics } from 'autoskeleton';
import { Button, useFakeLoad } from './controls';
import { useDemoTheme } from './theme';
import { Caption, DemoPage, Note, Panel, ReadoutRows, Row } from './ui';

/** 168 pt of viewport over 12 rows of 56 pt: three rows on screen and nine
 *  entirely past the fold. Chosen so the arithmetic is exact — 3 x 56 = 168 —
 *  and the reader can check the count instead of trusting it. */
const VIEWPORT_H = 168;
const ROW_H = 56;
const ROW_COUNT = 12;

const ROWS = Array.from({ length: ROW_COUNT }, (_, i) => `Row ${String(i + 1).padStart(2, '0')}`);

/** Two detected leaves per row and no more: one `<Text>`, and one view with an
 *  OPAQUE background. The container rule only contributes a shape for a
 *  non-transparent background, so a translucent swatch here would quietly
 *  halve every count on this screen. */
function ClipRow({ label }: { readonly label: string }): React.JSX.Element {
  const t = useDemoTheme();
  return (
    <View style={[styles.row, { borderBottomColor: t.color.line }]}>
      <View style={[styles.swatch, { backgroundColor: t.color.accentSoft }]} />
      <Text style={[t.type.body, { color: t.color.ink }]}>{label}</Text>
    </View>
  );
}

function Rows(): React.JSX.Element {
  return (
    <>
      {ROWS.map((label) => (
        <ClipRow key={label} label={label} />
      ))}
    </>
  );
}

function countOf(metrics: SkeletonMetrics | null): string {
  return metrics === null ? 'onMetrics has not fired yet' : String(metrics.shapeCount);
}

export function ScrollClipDemo(): React.JSX.Element {
  const load = useFakeLoad(2200);
  const [scrolling, setScrolling] = useState<SkeletonMetrics | null>(null);
  const [plain, setPlain] = useState<SkeletonMetrics | null>(null);

  const delta =
    scrolling === null || plain === null
      ? '—'
      : `${plain.shapeCount - scrolling.shapeCount} shapes never charged`;

  return (
    <DemoPage
      title="Scroll clipping"
      claim="A leaf below the fold of a scroll container is clipped away instead of being measured at full size — and never spends the shape budget."
    >
      <Row>
        <Button label="Load both (cold)" testID="demo-clip-reload" onPress={load.reloadCold} />
      </Row>

      <Panel
        label="inside a <ScrollView> — clipped"
        note="Twelve rows, three of them on screen. Every leaf frame is intersected with the scroll viewport before it becomes a shape."
      >
        <AutoSkeleton
          key={`scroll-${load.coldKey}`}
          isLoading={load.isLoading}
          skeletonKey="demo-clip-scrolling"
          onMetrics={setScrolling}
        >
          <ScrollView style={styles.viewport} nestedScrollEnabled>
            <Rows />
          </ScrollView>
        </AutoSkeleton>
      </Panel>

      <Panel
        label="inside a plain <View overflow='hidden'> — not clipped"
        note="The same twelve rows, cropped to the same 168 pt. This container does not scroll, so the sensor deliberately does not clip against it and all twelve rows are measured."
      >
        <AutoSkeleton
          key={`plain-${load.coldKey}`}
          isLoading={load.isLoading}
          skeletonKey="demo-clip-plain"
          onMetrics={setPlain}
        >
          <View style={styles.viewport}>
            <Rows />
          </View>
        </AutoSkeleton>
      </Panel>

      <ReadoutRows
        rows={[
          ['rows rendered', String(ROW_COUNT)],
          ['rows on screen', String(Math.floor(VIEWPORT_H / ROW_H))],
          ['ScrollView shapes', countOf(scrolling)],
          ['plain View shapes', countOf(plain)],
          ['saved', delta],
        ]}
      />
      <Caption>
        Two leaves per row: one `&lt;Text&gt;` and one opaque swatch. A fully clipped frame reaches
        the degenerate-frame guard and is dropped there.
      </Caption>

      <Note>
        The shape budget is the reason this matters. Shapes are capped
        (`SkeletonProvider maxShapes`), and a cap spent on geometry below the fold truncates the
        part of the skeleton the reader is actually looking at. Clipping is narrower than the web
        rule on purpose: only scrolling ancestors, never every parent that crops its children.
      </Note>
    </DemoPage>
  );
}

const styles = StyleSheet.create({
  viewport: {
    height: VIEWPORT_H,
    overflow: 'hidden',
  },
  row: {
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 8,
  },
});
