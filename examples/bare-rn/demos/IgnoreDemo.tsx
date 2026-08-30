/**
 * DEMO — `<AutoSkeleton.Ignore>`.
 *
 * Not everything inside a loading region is loading. A live clock, a
 * connection badge, a "retry" affordance: those are already correct, and
 * covering them with a placeholder is a lie about the state of the app.
 *
 * `Ignore` is layout-neutral by construction — it clones its single element
 * child and stamps a marker `nativeID`/`testID` rather than wrapping it in a
 * `View`, so it introduces no flex container and moves nothing. (Both props,
 * not one: `nativeID` reaches Android's lookup tag, but on iOS it is `testID`
 * that reaches `accessibilityIdentifier`, which is what the iOS sensor reads.)
 *
 * The ticking clock is the demo's own control assertion: if it keeps counting
 * while everything around it is a placeholder, the region really was excluded
 * rather than merely painted over in the same colour.
 *
 * GOTCHA, hit while writing this demo and worth stating plainly: because the
 * mechanism is `cloneElement`, the child has to be something those props can
 * actually reach — a HOST element (`<View>`, `<Text>`, `<Image>`) or a
 * component that forwards `nativeID`/`testID` to one. Wrapping a composite
 * component that swallows its props compiles, renders, and silently does
 * nothing: the marker never reaches a native view and the region is painted
 * over anyway. That is why the `<View>` below is written out here instead of
 * `<AutoSkeleton.Ignore><LiveClock /></AutoSkeleton.Ignore>`, which is what
 * this file said first and which did not work.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AutoSkeleton } from 'autoskeleton';
import { Button, useFakeLoad } from './controls';
import { DEMO_COLORS, DemoPage, Panel, Row } from './ui';

function useClock(): string {
  const [now, setNow] = useState(() => new Date().toLocaleTimeString());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function IgnoreDemo(): React.JSX.Element {
  const load = useFakeLoad(60_000);
  const now = useClock();

  return (
    <DemoPage
      title="Ignore"
      claim="Content that is already correct stays visible and keeps updating while everything around it loads."
    >
      <Panel
        label="<AutoSkeleton.Ignore>"
        note="The green badge is inside Ignore and keeps ticking. Its grey twin on the right is an ordinary sibling in the same frame, and gets a placeholder."
      >
        <AutoSkeleton key={load.coldKey} isLoading={load.isLoading} skeletonKey="demo-ignore">
          <View style={styles.card}>
            <View style={styles.badgeRow}>
              {/* A host `<View>`, so the cloned marker reaches a real native
                  view. See this file's header for what happens if it does
                  not. */}
              <AutoSkeleton.Ignore>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{`live · ${now}`}</Text>
                </View>
              </AutoSkeleton.Ignore>
              <View style={styles.mutedBadge}>
                <Text style={styles.badgeText}>not ignored</Text>
              </View>
            </View>
            <View style={styles.headline} />
            <View style={styles.paragraph} />
          </View>
        </AutoSkeleton>
      </Panel>

      <Row>
        <Button label="Reveal content" tone="quiet" testID="demo-ignore-reveal" onPress={load.reveal} />
        <Button label="Show skeleton again" testID="demo-ignore-cold" onPress={load.reloadCold} />
      </Row>
    </DemoPage>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 12,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#16a34a',
  },
  mutedBadge: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#94a3b8',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  headline: {
    width: '80%',
    height: 22,
    backgroundColor: DEMO_COLORS.ink,
    borderRadius: 4,
  },
  paragraph: {
    width: '100%',
    height: 64,
    backgroundColor: '#334155',
    borderRadius: 4,
  },
});
