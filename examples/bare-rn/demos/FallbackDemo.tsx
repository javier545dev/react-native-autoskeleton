/**
 * DEMO — the cold miss, and `fallback` closing it.
 *
 * This is the library's biggest structural hole made visible, side by side
 * with its fix. Both panels are the SAME component with the SAME function
 * child. Only the second one passes `fallback`.
 *
 * WHY THE FIRST PANEL PAINTS NOTHING. The sensor measures the wrapper's
 * CHILDREN, and there is no geometry for a key until something has been
 * measured under it. A function child runs only when `data` is non-nullish
 * (`core/data-props.ts`), so on the first loading cycle of a session there is
 * nothing mounted to measure and nothing cached to fall back on. The gate both
 * components spell `snapshot === null || isEmptySnapshot(snapshot)` is true,
 * and without a `fallback` there is simply nothing to put on screen.
 *
 * MEASURED ON DEVICE (iPhone 17, iOS 26.5 simulator, 2026-09-02), and this is
 * more interesting than the docs' worst case:
 *
 *   cycle 1 (cold, nothing cached)  first panel BLANK for the whole 2.2 s.
 *                                   second panel shows the hand-authored
 *                                   stand-in. Both then report
 *                                   `shapeCount: 2, cacheHit: false`.
 *   cycle 2 ("Load both (cold)")    BOTH panels paint a real measured
 *                                   skeleton of two bars, `cacheHit: true`,
 *                                   and the `fallback` correctly steps aside
 *                                   because there is now usable geometry.
 *
 * So on this platform the traversal did capture the two `<Text>` leaves — it
 * caught them in the frame where `data` arrived and the function child mounted
 * — and the second cycle was rescued. Do not read that as a guarantee. The
 * measurement can just as easily land on an empty subtree, and
 * `core/snapshot.ts` re-attempts an empty result only `MAX_EMPTY_MEASUREMENTS`
 * times before it is permanent for that key. What `fallback` buys is the one
 * cycle that is never in doubt: the first.
 *
 * `shapeCount: 2` on BOTH instances is also the proof that `fallback` is never
 * measured. The second panel renders THREE hand-authored blocks and still
 * reports two shapes — the headline and the standfirst of the real content.
 * The fallback is wrapped in the same ignore channel as
 * `<AutoSkeleton.Ignore>`, so the library can never cache a skeleton of your
 * skeleton. It is also hidden from assistive technology; the
 * `accessibilityLabel="Loading"` sibling is what a screen-reader user gets.
 *
 * The honest reading of this screen: `fallback` is the migration ramp. Put
 * your existing hand-authored skeleton in it, and consumers whose children
 * stay mounted get the MEASURED one from the first cycle onward — which is
 * what every other demo in this gallery shows.
 */

import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AutoSkeleton } from 'autoskeleton';
import type { SkeletonMetrics } from 'autoskeleton';
import { Button, useFakeLoad } from './controls';
import { useDemoTheme } from './theme';
import { Caption, DemoPage, Note, Panel, ReadoutRows, Row } from './ui';

interface Article {
  readonly headline: string;
  readonly standfirst: string;
}

const ARTICLE: Article = {
  headline: 'On the Analytical Engine',
  standfirst:
    'A note on the algebraic patterns the engine weaves, and on the operations it may be made to perform.',
};

function ArticleCard({ article }: { readonly article: Article }): React.JSX.Element {
  const t = useDemoTheme();
  return (
    <View style={{ gap: t.space.xs }}>
      <Text style={[t.type.heading, { color: t.color.ink }]}>{article.headline}</Text>
      <Text style={[t.type.body, { color: t.color.muted }]}>{article.standfirst}</Text>
    </View>
  );
}

/** Hand-authored, TINTED rather than neutral grey, so this screen can never be
 *  read as "the library measured something after all". The library's own
 *  output on these screens is borderless neutral grey — see `theme.ts`. */
function HandAuthored(): React.JSX.Element {
  const t = useDemoTheme();
  return (
    <View style={{ gap: t.space.sm }}>
      <View style={[styles.block, styles.blockHead, { backgroundColor: t.color.accentSoft }]} />
      <View style={[styles.block, styles.blockBody, { backgroundColor: t.color.accentSoft }]} />
      <View style={[styles.block, styles.blockTail, { backgroundColor: t.color.accentSoft }]} />
    </View>
  );
}

function shapeCountOf(metrics: SkeletonMetrics | null): string {
  return metrics === null ? 'onMetrics has not fired yet' : String(metrics.shapeCount);
}

export function FallbackDemo(): React.JSX.Element {
  const load = useFakeLoad(2200);
  const article: Article | null = load.isLoading ? null : ARTICLE;
  const [bare, setBare] = useState<SkeletonMetrics | null>(null);
  const [withFallback, setWithFallback] = useState<SkeletonMetrics | null>(null);

  return (
    <DemoPage
      title="Cold miss & fallback"
      claim="With a strictly conditional child there is nothing to measure, so the first loading state of a session paints nothing. fallback is what fills it."
    >
      <Row>
        <Button label="Load both (cold)" testID="demo-fallback-reload" onPress={load.reloadCold} />
      </Row>

      <Panel
        label="no fallback — the hole"
        note="A function child renders nothing while data is nullish. On the first cycle of a session there is nothing mounted to measure and nothing cached, so this panel is blank for the whole loading window."
      >
        <View style={styles.host}>
          <AutoSkeleton
            key={`bare-${load.coldKey}`}
            data={article}
            skeletonKey="demo-fallback-bare"
            onMetrics={setBare}
          >
            {(value) => <ArticleCard article={value} />}
          </AutoSkeleton>
        </View>
      </Panel>
      <ReadoutRows
        rows={[
          ['fallback prop', 'not passed'],
          ['shapeCount', shapeCountOf(bare)],
          ['cacheHit', bare === null ? '—' : String(bare.cacheHit)],
        ]}
      />

      <Panel
        label="fallback={<HandAuthored />}"
        note="Same component, same function child, same cold miss. The only difference is that this one has something to put on screen while there is no measured geometry yet."
      >
        <View style={styles.host}>
          <AutoSkeleton
            key={`filled-${load.coldKey}`}
            data={article}
            skeletonKey="demo-fallback-filled"
            fallback={<HandAuthored />}
            onMetrics={setWithFallback}
          >
            {(value) => <ArticleCard article={value} />}
          </AutoSkeleton>
        </View>
      </Panel>
      <ReadoutRows
        rows={[
          ['fallback prop', '<HandAuthored />'],
          ['shapeCount', shapeCountOf(withFallback)],
          ['cacheHit', withFallback === null ? '—' : String(withFallback.cacheHit)],
        ]}
      />
      <Caption>
        The tinted blocks are this app&apos;s own markup. Both instances report the SAME
        `shapeCount`, and it counts the two real text leaves — never the three hand-authored blocks.
        `fallback` is wrapped in the ignore channel, so the library can never cache a skeleton of
        your skeleton.
      </Caption>

      <Note>
        Press &ldquo;Load both (cold)&rdquo; again and both panels paint a measured skeleton: the
        first cycle left usable geometry behind, so `fallback` steps aside. That rescue is not
        something to rely on — an empty measurement is re-attempted only a bounded number of times
        before it becomes permanent for that cache key. What `fallback` guarantees is the one cycle
        that is never in doubt: the first one of the session, which is the one every new reader sees.
      </Note>
      <Note>
        `fallback` obeys the rest of the contract too: it does not appear during a `delay` window,
        and on a refresh cycle suppressed by REQ-PTR-1 it does not appear at all — covering content
        the reader is still looking at is exactly what that policy exists to prevent.
      </Note>
    </DemoPage>
  );
}

const styles = StyleSheet.create({
  host: {
    minHeight: 96,
  },
  block: {
    height: 18,
    borderRadius: 4,
  },
  blockHead: {
    width: '62%',
    height: 22,
  },
  blockBody: {
    width: '100%',
  },
  blockTail: {
    width: '78%',
  },
});
