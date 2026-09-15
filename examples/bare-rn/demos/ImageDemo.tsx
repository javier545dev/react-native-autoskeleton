/**
 * DEMO — Images.
 *
 * An `<Image>` is a detected leaf in its own right: the native sensor
 * recognises `ReactImageView` (Android) / `RCTImageComponentView` (iOS) and
 * emits its exact frame, so the placeholder has the picture's real aspect
 * ratio instead of a generic grey bar.
 *
 * The three-phase pipeline (brief §9b) is also spelled out here, because the
 * honest version of this feature is where autoskeleton STOPS: phase 1
 * (skeleton) is ours; phase 2 (blurhash/thumbhash placeholder) and phase 3
 * (decoded image) belong to the image component. `expectsPlaceholder` is the
 * prop that tells us a successor will paint, so the skeleton does not unmount
 * into a white flash before it does.
 *
 * Bare React Native has no `expo-image`, so there is no phase-2 component
 * here to hand off TO — `examples/expo` owns that half of the story.
 */

import { Image, StyleSheet, View } from 'react-native';
import { AutoSkeleton } from 'autoskeleton';
import { Button, useFakeLoad } from './controls';
import { useDemoTheme } from './theme';
import { DemoPage, Panel, Row } from './ui';

const PHOTO = require('../assets/photo.png');
const AVATAR = require('../assets/avatar.png');

export function ImageDemo(): React.JSX.Element {
  const t = useDemoTheme();
  const load = useFakeLoad(1800);

  return (
    <DemoPage
      title="Images"
      claim="An image is a detected leaf. The placeholder gets the picture's real frame, not a generic bar."
    >
      <Panel
        label="hero + thumbnails"
        note="One 16:9 hero and three squares. Nothing here declares a skeleton shape; the rectangles come from the images' measured frames."
      >
        <AutoSkeleton key={load.coldKey} isLoading={load.isLoading} skeletonKey="demo-images">
          <View style={styles.gallery}>
            <Image
              source={PHOTO}
              style={[styles.hero, { backgroundColor: t.color.codeBg }]}
              resizeMode="cover"
            />
            <View style={styles.thumbRow}>
              <Image source={AVATAR} style={[styles.thumb, { backgroundColor: t.color.codeBg }]} />
              <Image source={AVATAR} style={[styles.thumb, { backgroundColor: t.color.codeBg }]} />
              <Image source={AVATAR} style={[styles.thumb, { backgroundColor: t.color.codeBg }]} />
            </View>
          </View>
        </AutoSkeleton>
      </Panel>
      <Row>
        <Button label="Load again (cold)" testID="demo-images-reload" onPress={load.reloadCold} />
      </Row>
    </DemoPage>
  );
}

const styles = StyleSheet.create({
  gallery: {
    gap: 12,
  },
  hero: {
    width: '100%',
    height: 168,
    borderRadius: 12,
  },
  thumbRow: {
    flexDirection: 'row',
    gap: 12,
  },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: 10,
  },
});
