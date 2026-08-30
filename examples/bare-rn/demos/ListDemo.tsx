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
import { DEMO_COLORS, Readout } from './ui';

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

/** The real, loaded row. Also the template the skeleton is measured from —
 *  one source of truth, so the placeholder can never drift from the content.
 *  Not one width in here is hand-computed: the text column takes what the row
 *  gives it, which is what makes this the same component in both roles. */
function FeedRow({ title }: { title: string }): React.JSX.Element {
  return (
    <View style={styles.row}>
      <View style={styles.rowAvatar} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.rowLine} />
      </View>
    </View>
  );
}

/** `useSkeletonCell` used directly: the hook answers what the cache knows
 *  about this `itemType` right now. This row renders the ordinary
 *  `SkeletonCell` but labels itself with the cache state the hook reported —
 *  the escape hatch for a cell that needs to branch on it. */
function InspectedRow(): React.JSX.Element {
  const cell = useSkeletonCell({ itemType: ROW_TYPE, skeletonKey: ROW_TYPE });
  return (
    <View style={styles.inspected}>
      <Text style={styles.inspectedLabel} numberOfLines={1}>
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
    <View style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.title}>Virtualized lists</Text>
        <Text style={styles.claim}>
          One template measurement per itemType, ever. Scroll as hard as you like — the counter must
          not move.
        </Text>
        <Readout>{`templateTraversalCounter.count: ${traversals}`}</Readout>
        <View style={styles.headerButtons}>
          <Button
            label={showEmpty ? 'Hide empty state' : 'Show empty state'}
            tone="quiet"
            testID="demo-list-empty-toggle"
            onPress={() => setShowEmpty((v) => !v)}
          />
          <Button label="Shuffle rows" testID="demo-list-shuffle" onPress={() => setSeed((s) => s + 1)} />
        </View>
      </View>

      {showEmpty ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SkeletonList — nothing loaded yet</Text>
          <SkeletonList
            itemType={EMPTY_TYPE}
            skeletonKey={EMPTY_TYPE}
            estimatedCount={2}
            rowSpacing={8}
            renderTemplate={() => <FeedRow title="template" />}
          />
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>SkeletonCell — per-cell loading in a live FlashList</Text>
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
            <Text style={styles.sectionLabel}>SkeletonListFooter — loading the next page</Text>
            <SkeletonListFooter itemType={ROW_TYPE} skeletonKey={ROW_TYPE} estimatedCount={3} rowSpacing={8} />
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: DEMO_COLORS.canvas,
  },
  header: {
    padding: 16,
    gap: 8,
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: DEMO_COLORS.ink,
  },
  claim: {
    fontSize: 13,
    lineHeight: 18,
    color: DEMO_COLORS.muted,
  },
  section: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: DEMO_COLORS.muted,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  list: {
    flex: 1,
  },
  rowHost: {
    height: ROW_HEIGHT,
    paddingHorizontal: 16,
  },
  row: {
    height: ROW_HEIGHT,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#2f6fed',
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
    color: DEMO_COLORS.ink,
  },
  rowLine: {
    width: '70%',
    height: 14,
    borderRadius: 4,
    backgroundColor: '#cbd5e1',
  },
  inspected: {
    height: ROW_HEIGHT,
    gap: 2,
  },
  inspectedLabel: {
    fontFamily: 'Courier',
    fontSize: 10,
    color: DEMO_COLORS.muted,
    paddingHorizontal: 16,
  },
});
