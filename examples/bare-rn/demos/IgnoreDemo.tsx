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
import { useDemoTheme } from './theme';
import { DemoPage, Panel, Row } from './ui';

/** A composite that does NOT forward `nativeID`/`testID`, which is the exact
 *  shape that makes `Ignore` do nothing. Written out here rather than described
 *  in prose so the demo can show the failure instead of only warning about it:
 *  the third badge below is wrapped in `Ignore` and gets covered anyway.
 *
 *  Since `Ignore` now warns in dev when its child is a plain function
 *  component, opening this screen with the Metro logs visible is also how you
 *  see the warning fire on a real render rather than only in a unit test. */
function SwallowingBadge(props: { readonly label: string }): React.JSX.Element {
  const t = useDemoTheme();
  return (
    <View style={[styles.badge, { backgroundColor: t.color.lineStrong }]}>
      <Text style={styles.badgeText}>{props.label}</Text>
    </View>
  );
}

function useClock(): string {
  const [now, setNow] = useState(() => new Date().toLocaleTimeString());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function IgnoreDemo(): React.JSX.Element {
  const t = useDemoTheme();
  const load = useFakeLoad(60_000);
  const now = useClock();

  return (
    <DemoPage
      title="Ignore"
      claim="Content that is already correct stays visible and keeps updating while everything around it loads."
    >
      <Panel
        label="<AutoSkeleton.Ignore>"
        note="Three badges. The first is inside Ignore wrapping a host View and keeps ticking. The second is an ordinary sibling and gets a placeholder, as it should. The third is ALSO inside Ignore — but wrapping a composite that swallows the marker, so it gets a placeholder too. Metro logs the warning for it."
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
              {/* Wrapped in `Ignore` exactly like the first badge, and covered
                  anyway: `cloneElement` hands `nativeID`/`testID` to
                  `SwallowingBadge`, which never passes them to a native view.
                  Nothing errors. This is the whole defect, on screen. */}
              <AutoSkeleton.Ignore>
                <SwallowingBadge label="ignored?" />
              </AutoSkeleton.Ignore>
            </View>
            <View style={[styles.headline, { backgroundColor: t.color.ink }]} />
            <View style={[styles.paragraph, { backgroundColor: t.color.lineStrong }]} />
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
    borderRadius: 4,
  },
  paragraph: {
    width: '100%',
    height: 64,
    borderRadius: 4,
  },
});
