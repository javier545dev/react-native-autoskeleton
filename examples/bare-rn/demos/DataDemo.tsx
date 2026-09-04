/**
 * DEMO — `data`, the function child, and which prop decides "loading".
 *
 * The rule, from `src/core/data-props.ts` and `docs/api.md` §2.1:
 *
 *     loading = isLoading is provided ? isLoading : data == null
 *
 * `== null` is loose ON PURPOSE and is exactly nullish. `0`, `''`, `false` and
 * `NaN` are ordinary loaded values. The second panel exists because that is
 * the one rule a reader of this API can most easily get wrong: a truthiness
 * test there would leave `<AutoSkeleton data={cartItemCount}>` sitting on a
 * skeleton forever the moment the cart empties.
 *
 * The function child is invoked only when `data` is non-nullish and receives
 * `NonNullable<T>` — `Profile`, never `Profile | null`. That narrowing is the
 * whole point of the form: it removes the second, inverted copy of the
 * condition that `{profile !== null && <ProfileCard profile={profile} />}`
 * used to force you to write.
 *
 * The first panel passes `fallback` and the Cold miss demo explains why that
 * is not optional here: a strictly conditional child means there is nothing
 * mounted for the sensor to measure while loading. Read that demo next.
 *
 * Both instances below pass `skeletonOnRefresh`, because every button here
 * puts a LIVE instance back into loading and REQ-PTR-1 would otherwise keep
 * the content on screen and change nothing visible. That is the correct
 * default for a pull-to-refresh and useless for a control you are pressing to
 * watch the skeleton come back.
 */

import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AutoSkeleton } from 'autoskeleton';
import { Button, useFakeLoad } from './controls';
import { useDemoTheme } from './theme';
import { Caption, DemoPage, Note, Panel, ReadoutRows, Row } from './ui';

interface Profile {
  readonly name: string;
  readonly role: string;
  readonly bio: string;
}

const ADA: Profile = {
  name: 'Ada Lovelace',
  role: 'Analytical Engine',
  bio: 'The Analytical Engine weaves algebraic patterns just as the Jacquard loom weaves flowers and leaves.',
};

/** The value a nullish `data` prop stands in for. Rendered only through the
 *  function child, so this component's props can be `Profile` and never
 *  `Profile | null`. */
function ProfileCard({ profile }: { readonly profile: Profile }): React.JSX.Element {
  const t = useDemoTheme();
  return (
    <View style={{ gap: t.space.xs }}>
      <Text style={[t.type.heading, { color: t.color.ink }]}>{profile.name}</Text>
      <Text style={[t.type.label, { color: t.color.muted }]}>{profile.role}</Text>
      <Text style={[t.type.body, { color: t.color.ink }]}>{profile.bio}</Text>
    </View>
  );
}

/** The hand-authored stand-in passed as `fallback`. Deliberately TINTED rather
 *  than neutral grey: the library paints borderless neutral-grey rectangles,
 *  so a grey fallback here would be indistinguishable from library output and
 *  this screen would stop being able to tell you which one you are looking at.
 *  See the rules in `theme.ts`. */
function TintedFallback(): React.JSX.Element {
  const t = useDemoTheme();
  return (
    <View style={{ gap: t.space.sm }}>
      <View style={[styles.block, styles.blockTitle, { backgroundColor: t.color.accentSoft }]} />
      <View style={[styles.block, styles.blockRole, { backgroundColor: t.color.accentSoft }]} />
      <View style={[styles.block, styles.blockBody, { backgroundColor: t.color.accentSoft }]} />
    </View>
  );
}

export function DataDemo(): React.JSX.Element {
  const t = useDemoTheme();
  const load = useFakeLoad(1600);
  const profile: Profile | null = load.isLoading ? null : ADA;

  // `undefined` = the value has not arrived. `0` is a perfectly good count.
  const [count, setCount] = useState<number | undefined>(undefined);

  return (
    <DemoPage
      title="data-driven loading"
      claim="Pass the value instead of a predicate. Nullish data means loading — and nothing else does."
    >
      <Panel
        label="<AutoSkeleton data={profile} fallback={…}>{(profile) => …}</AutoSkeleton>"
        note="The child is a function. It runs only when data is non-nullish, and its argument is Profile — not Profile | null."
      >
        <View style={styles.host}>
          <AutoSkeleton
            data={profile}
            skeletonKey="demo-data-profile"
            skeletonOnRefresh
            fallback={<TintedFallback />}
          >
            {(value) => <ProfileCard profile={value} />}
          </AutoSkeleton>
        </View>
      </Panel>
      <ReadoutRows
        rows={[
          ['data', profile === null ? 'null' : `{ name: '${profile.name}', … }`],
          ['isLoading prop', 'not passed'],
          ['resolved loading', String(profile === null)],
          ['function child ran', String(profile !== null)],
        ]}
      />
      <Row>
        <Button label="Load again" testID="demo-data-reload" onPress={load.reload} />
      </Row>
      <Caption>
        The tinted blocks during loading are this app&apos;s hand-authored `fallback`, not library
        output — see the Cold miss demo for why a function child needs one.
      </Caption>

      <Panel
        label="the falsy trap: data={count}"
        note="0 is a loaded value. Only null and undefined mean loading. A truthiness test here would hang the skeleton the moment the count reached zero."
      >
        <View style={styles.counterHost}>
          <AutoSkeleton data={count} skeletonKey="demo-data-count" skeletonOnRefresh>
            <Text style={[styles.counter, { color: t.color.ink }]}>
              {count === undefined ? '—' : String(count)}
            </Text>
          </AutoSkeleton>
        </View>
      </Panel>
      <ReadoutRows
        rows={[
          ['data', count === undefined ? 'undefined' : String(count)],
          ['typeof data', typeof count],
          ['data == null', String(count == null)],
          ['resolved loading', String(count == null)],
        ]}
      />
      <Row>
        <Button
          label="data = undefined"
          tone="quiet"
          testID="demo-data-count-clear"
          onPress={() => setCount(undefined)}
        />
        <Button label="data = 0" testID="demo-data-count-zero" onPress={() => setCount(0)} />
        <Button label="data = 3" testID="demo-data-count-three" onPress={() => setCount(3)} />
      </Row>
      <Note>
        A plain node child is still accepted with `data`. It is the right choice whenever your
        content can render before the value arrives — as this counter does, with an em dash — and it
        is also what keeps the subtree mounted for the sensor to measure.
      </Note>

      <Panel
        label="isLoading wins"
        note="data is a real Profile the whole time. isLoading is the escape hatch for every loading state data cannot express — an isFetching flag, a state derived from several sources, a skeleton shown deliberately."
      >
        <View style={styles.host}>
          <AutoSkeleton
            data={ADA}
            isLoading={load.isLoading}
            skeletonKey="demo-data-explicit"
            skeletonOnRefresh
          >
            {(value) => <ProfileCard profile={value} />}
          </AutoSkeleton>
        </View>
      </Panel>
      <ReadoutRows
        rows={[
          ['data', "{ name: 'Ada Lovelace', … }"],
          ['isLoading prop', String(load.isLoading)],
          ['resolved loading', String(load.isLoading)],
        ]}
      />
      <Row>
        <Button
          label="Load again"
          testID="demo-data-explicit-reload"
          onPress={load.reload}
        />
      </Row>
      <Note>
        Passing both is legal and discouraged. `data` then decides only what the function child
        receives, never whether the skeleton shows — which is why this instance keeps rendering its
        content underneath while `isLoading` is true, and needs no `fallback`.
      </Note>
    </DemoPage>
  );
}

const styles = StyleSheet.create({
  host: {
    minHeight: 116,
  },
  counterHost: {
    minHeight: 44,
  },
  counter: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '700',
  },
  block: {
    height: 18,
    borderRadius: 4,
  },
  blockTitle: {
    width: '52%',
    height: 22,
  },
  blockRole: {
    width: '34%',
    height: 14,
  },
  blockBody: {
    width: '100%',
    height: 44,
  },
});
