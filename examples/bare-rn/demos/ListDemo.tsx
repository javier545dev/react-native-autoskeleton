/**
 * DEMO — Virtualized lists.
 *
 * All four list APIs in one screen, because they are three different problems
 * that only look like one:
 *
 *   `SkeletonList`       initial load, empty list: there are no cells to
 *                        measure yet, so ONE invisible template cell is
 *                        measured once and cached, and N synthetic rows are
 *                        drawn from it.
 *   `SkeletonCell`       per-cell loading inside a live list. Hard rule: ZERO
 *                        traversal on bind — a synchronous cache lookup by
 *                        `itemType`, or the recycler would stutter.
 *   `SkeletonListFooter` pagination. Same `itemType` as the rows above it, so
 *                        by the time it mounts the shapes are already cached.
 *   `useSkeletonCell`    the raw hook the components are built on, for a cell
 *                        that needs the snapshot/cache state itself.
 *
 * The traversal counter at the top is the load-bearing readout: scroll the
 * list hard and it must NOT climb. One measurement per `itemType`, ever.
 *
 * `FeedRow` inherits its width — `flex: 1` for the text column, `70%` for the
 * sub-line — and is passed to `renderTemplate` exactly as written. That is
 * deliberate, and it is the point.
 *
 * It did not always work. This demo used to thread an explicit `rowWidth` from
 * `useWindowDimensions()` into every template, because the off-screen
 * measurement container declared only `left`/`top` and so laid the template
 * out at its INTRINSIC width, collapsing every width-inheriting child: the
 * snapshot came back 92pt wide against a 411pt row, and every skeleton row
 * painted as a lone avatar square with nothing beside it. The container now
 * declares both horizontal insets, which makes Yoga resolve it to its
 * parent's content width — and its parent is the list, which has always known
 * the real width. The workaround is gone because the reason for it is gone,
 * not because it was tidied away.
 *
 * LAYOUT NOTE (2026-08-30): this screen used to hand-roll its own title,
 * claim and page padding instead of using `DemoPage`, and the two gutters
 * stacked — the first section label sat 32pt in while everything above it sat
 * at 16pt, which read as a rendering bug. There is now exactly ONE horizontal
 * gutter on this screen, `DemoPage`'s, and every row below inherits it. Rows
 * carry no horizontal padding of their own, which is also why the template
 * they are measured from inherits the full row width.
 */

import { useEffect, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import { StyleSheet, Text, View } from 'react-native';
import {
  SkeletonCell,
  SkeletonList,
  SkeletonListFooter,
  templateTraversalCounter,
  useSkeletonCell,
} from 'autoskeleton';
import { Button } from './controls';
import { useDemoTheme } from './theme';
import { DemoPage, Readout, Row } from './ui';

const ROW_TYPE = 'demo-feed-row';
const EMPTY_TYPE = 'demo-feed-empty';
const ROW_HEIGHT = 88;

interface FeedItem {
  readonly id: string;
  readonly loaded: boolean;
}

function makeFeed(seed: number): readonly FeedItem[] {
  return Array.from({ length: 60 }, (_, i) => ({
    id: `row-${i}`,
    // Two thirds of the rows are still resolving, so scrolling genuinely
    // recycles native views between skeleton and content states.
    loaded: (i + seed) % 3 === 0,
  }));
}

/** A section label inside the list body. Same type role as a panel label, so
 *  the four APIs read as four labelled stages rather than four paragraphs. */
function SectionLabel({ children }: { readonly children: string }): React.JSX.Element {
  const t = useDemoTheme();
  return <Text style={[t.type.heading, { color: t.color.ink }]}>{children}</Text>;
}

/** The real, loaded row. Also the template the skeleton is measured from —
 *  one source of truth, so the placeholder can never drift from the content.
 *  Not one width in here is hand-computed: the text column takes what the row
 *  gives it, which is what makes this the same component in both roles. */
function FeedRow({ title }: { title: string }): React.JSX.Element {
  const t = useDemoTheme();
  return (
    <View style={styles.row}>
      <View style={[styles.rowAvatar, { backgroundColor: t.color.accent }]} />
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: t.color.ink }]} numberOfLines={1}>
          {title}
        </Text>
        <View style={[styles.rowLine, { backgroundColor: t.color.lineStrong }]} />
      </View>
    </View>
  );
}

/** `useSkeletonCell` used directly: the hook answers what the cache knows
 *  about this `itemType` right now. This row renders the ordinary
 *  `SkeletonCell` but labels itself with the cache state the hook reported —
 *  the escape hatch for a cell that needs to branch on it. */
function InspectedRow(): React.JSX.Element {
  const t = useDemoTheme();
  const cell = useSkeletonCell({ itemType: ROW_TYPE, skeletonKey: ROW_TYPE });
  return (
    <View style={styles.inspected}>
      <Text
        style={[t.type.code, styles.inspectedLabel, { fontFamily: t.mono, color: t.color.faint }]}
        numberOfLines={1}
      >
        {`useSkeletonCell → cacheHit: ${cell.cacheHit}  isFallback: ${cell.isFallback}  snapshot: ${
          cell.snapshot === null ? 'null' : `${cell.snapshot.frameWidth}x${cell.snapshot.frameHeight}`
        }`}
      </Text>
      <View style={styles.rowHost}>
        <SkeletonCell itemType={ROW_TYPE} skeletonKey={ROW_TYPE} />
      </View>
    </View>
  );
}

function useTraversalCount(): number {
  const [count, setCount] = useState(templateTraversalCounter.count);
  useEffect(() => {
    const id = setInterval(() => setCount(templateTraversalCounter.count), 200);
    return () => clearInterval(id);
  }, []);
  return count;
}

export function ListDemo(): React.JSX.Element {
  const traversals = useTraversalCount();
  const [seed, setSeed] = useState(0);
  const [showEmpty, setShowEmpty] = useState(true);
  const feed = makeFeed(seed);

  return (
    <DemoPage
      scroll={false}
      title="Virtualized lists"
      claim="One template measurement per itemType, ever. Scroll as hard as you like — the counter must not move."
    >
      <Readout>{`templateTraversalCounter.count: ${traversals}`}</Readout>
      <Row>
        <Button
          label={showEmpty ? 'Hide empty state' : 'Show empty state'}
          tone="quiet"
          testID="demo-list-empty-toggle"
          onPress={() => setShowEmpty((v) => !v)}
        />
        <Button label="Shuffle rows" testID="demo-list-shuffle" onPress={() => setSeed((s) => s + 1)} />
      </Row>

      {showEmpty ? (
        <View style={styles.section}>
          <SectionLabel>SkeletonList — nothing loaded yet</SectionLabel>
          <SkeletonList
            itemType={EMPTY_TYPE}
            skeletonKey={EMPTY_TYPE}
            estimatedCount={2}
            rowSpacing={8}
            renderTemplate={() => <FeedRow title="template" />}
          />
        </View>
      ) : null}

      <SectionLabel>SkeletonCell — per-cell loading in a live FlashList</SectionLabel>
      <FlashList
        style={styles.list}
        data={feed}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => {
          if (item.loaded) {
            return <FeedRow title={`Item ${index}`} />;
          }
          if (index === 1) {
            return <InspectedRow />;
          }
          return (
            <View style={styles.rowHost}>
              <SkeletonCell
                itemType={ROW_TYPE}
                skeletonKey={ROW_TYPE}
                renderTemplate={() => <FeedRow title="template" />}
              />
            </View>
          );
        }}
        ListFooterComponent={
          <View style={styles.section}>
            <SectionLabel>SkeletonListFooter — loading the next page</SectionLabel>
            <SkeletonListFooter itemType={ROW_TYPE} skeletonKey={ROW_TYPE} estimatedCount={3} rowSpacing={8} />
          </View>
        }
      />
    </DemoPage>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingBottom: 12,
    gap: 8,
  },
  list: {
    flex: 1,
  },
  rowHost: {
    height: ROW_HEIGHT,
  },
  row: {
    // No horizontal padding: the page's single gutter already positions this,
    // and the template must inherit the row's full width. See the header.
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  rowText: {
    // Inherited, never computed. See this file's header.
    flex: 1,
    gap: 8,
  },
  rowTitle: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  rowLine: {
    width: '70%',
    height: 14,
    borderRadius: 4,
  },
  inspected: {
    height: ROW_HEIGHT,
    gap: 2,
  },
  inspectedLabel: {
    fontSize: 10,
  },
});
