/**
 * DEMO — the three-phase image pipeline, and where autoskeleton stops.
 *
 * `docs/image-pipeline.md` and `docs-examples/ImagePipelineExample.tsx`
 * describe this contract; this screen runs it.
 *
 *   Phase 1  skeleton      — no URL, nothing to decode. autoskeleton owns
 *                            this phase exclusively.
 *   Phase 2  placeholder   — the URL and its blurhash have arrived, the full
 *                            image has not decoded. `expo-image` owns this.
 *                            autoskeleton does not implement, decode or
 *                            manage blurhash, and never will: it would
 *                            duplicate `expo-image` and blow the web bundle
 *                            budget.
 *   Phase 3  image         — decoded and on screen. Not ours either.
 *
 * `expectsPlaceholder` is what makes the 1 -> 2 boundary not flash: it tells
 * autoskeleton a successor visual is coming, so the overlay is retained until
 * the successor paints or `handoffTimeoutMs` elapses.
 *
 * CURRENT NATIVE LIMITATION, shown rather than hidden: on web autoskeleton
 * wires automatic paint detection (double rAF + `img.decode()`). On native it
 * does not, so the handoff always falls through to the timeout path. The
 * `handoffReason` readout below therefore says `timeout`, not
 * `successor-painted` — on a real device, with a real image that loads
 * correctly. That is the honest state of the native pipeline today, and it is
 * exactly the signal the docs tell consumers to watch for.
 *
 * SECOND GOTCHA, measured here and NOT obvious: the skeleton is derived from
 * what is actually rendered, so the loading branch has to render SOMETHING
 * with a frame the sensor can detect. Written the natural way —
 * `{product !== null && <Image .../>}` — the subtree is empty during phase 1,
 * the traversal finds no leaves, and `onMetrics` reports `shapeCount: 0`: no
 * skeleton paints at all. (Measured on an Android emulator: `shapeCount: 0`,
 * `handoffReason: 'timeout'`.) A bare wrapper does not rescue it either — the
 * container rule falls back to a container's own shape only when that
 * container has a non-transparent background.
 *
 * `imageSlot` below — always mounted, explicitly sized, opaque — is therefore
 * the PATTERN, not a workaround for a defect, and it stays here for that
 * reason. Reviewed as a possible library defect on 2026-08-30 and deliberately
 * kept, because the alternative is worse in both directions:
 *
 *   1. The sensor measures the LOADING state. It cannot know that a
 *      currently-empty box will later hold an image, so painting a shape over
 *      it would mean inventing geometry no measurement produced — the one
 *      thing this library exists not to do.
 *   2. A non-transparent background is the only observable difference between
 *      a box that is content and a box that is structure. Transparent sized
 *      boxes are how every RN layout expresses spacers, flex fillers,
 *      safe-area padding and gap shims; if they contributed shapes, this
 *      screen would paint grey blocks over its own gutters.
 *
 * Reserving the space is also the better UI on its own terms — the slot is
 * what stops the layout jumping when the image lands. The rule is gated
 * across all three sensors by the shared
 * `container-rule-sized-but-transparent` fixture, and written up in
 * `docs/image-pipeline.md` §3a.
 */

import { useState } from 'react';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { AutoSkeleton, SkeletonProvider } from 'autoskeleton';
import type { SkeletonMetrics } from 'autoskeleton';
import { Button, useFakeLoad } from './controls';
import { useDemoTheme } from './theme';
import { Caption, DemoPage, Panel, Readout, ReadoutRows, Row } from './ui';

/** Bundled rather than fetched, so the demo does not depend on the emulator
 *  having a network. The blurhash is a real one for a similar gradient. */
const PRODUCT = require('../assets/product.png');
const BLURHASH = 'L6PZfSi_.AyE_3t7t7R**0o#DgR4';

export function ImagePipelineDemo(): React.JSX.Element {
  const t = useDemoTheme();
  const load = useFakeLoad(2200);
  const [metrics, setMetrics] = useState<SkeletonMetrics | null>(null);

  return (
    <DemoPage
      title="Image pipeline"
      claim="autoskeleton owns phase 1 and hands over cleanly. expo-image owns the blurhash placeholder and the decode."
    >
      <Row>
        <Button label="Load again (cold)" testID="demo-image-reload" onPress={load.reloadCold} />
      </Row>

      <SkeletonProvider handoffTimeoutMs={250} handoffFadeMs={120}>
        <Panel
          label="<AutoSkeleton expectsPlaceholder>"
          note="The skeleton is retained across isLoading=false until the successor paints or the handoff times out, so there is no white frame between the two."
        >
          <AutoSkeleton
            key={load.coldKey}
            isLoading={load.isLoading}
            skeletonKey="demo-image-pipeline"
            expectsPlaceholder
            onMetrics={setMetrics}
          >
            {/* Always mounted, sized and opaque, so phase 1 has a real frame
                to measure. This is the documented pattern, not boilerplate —
                see the second gotcha in this file's header for why the rule
                that requires it is correct. */}
            <View style={[styles.imageSlot, { backgroundColor: t.color.codeBg }]}>
              {load.isLoading ? null : (
                <Image
                  source={PRODUCT}
                  placeholder={{ blurhash: BLURHASH }}
                  placeholderContentFit="cover"
                  contentFit="cover"
                  style={styles.image}
                  transition={300}
                />
              )}
            </View>
          </AutoSkeleton>
        </Panel>
      </SkeletonProvider>

      <Panel label="what the handoff reported" live={false}>
        {metrics === null ? (
          <Readout>onMetrics has not fired yet.</Readout>
        ) : (
          <ReadoutRows
            rows={[
              ['handoffReason', metrics.handoffReason],
              ['renderer', metrics.renderer],
              ['shapeCount', String(metrics.shapeCount)],
              ['displayDurationMs', metrics.displayDurationMs.toFixed(0)],
            ]}
          />
        )}
        <Caption>
          `timeout` here is expected on native today — native paint detection is not wired yet, only
          the web path is. `displayDurationMs` still measures phase 1 only.
        </Caption>
      </Panel>
    </DemoPage>
  );
}

const styles = StyleSheet.create({
  imageSlot: {
    width: 180,
    height: 180,
    borderRadius: 12,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
