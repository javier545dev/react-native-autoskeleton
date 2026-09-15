/**
 * The gallery's navigation: a typed stack, a shared bar, and Android back.
 *
 * BYTE-IDENTICAL DUPLICATE. This file exists twice, at
 * `examples/bare-rn/demos/nav.tsx` and `examples/expo/demos/nav.tsx`;
 * `demos/theme.ts` is the other one. See that file's header for why the two
 * apps duplicate instead of sharing a folder. `diff` between the two copies
 * must print nothing.
 *
 * WHY THERE IS NO NAVIGATION LIBRARY HERE.
 * `@react-navigation/native-stack` would pull `react-native-screens` — a
 * NATIVE dependency — into the very app whose native build hosts five
 * instrumented pixel-gate suites, and would need Jest mocks before
 * `__tests__/App.test.tsx` could render `<App />` at all. The bare-rn app is
 * additionally under an ADR-14 guard that fails CI on any dependency it does
 * not need. And the gates force the launch screen to bypass any navigator
 * anyway (see `DemoGallery.tsx`), so a navigator would only ever wrap the
 * subtree a `useState` already handles. Roughly eighty lines of `useState` is
 * the cheaper correct answer, and this is them.
 *
 * What a real navigator would have given us for free, and what is therefore
 * implemented below rather than skipped: the Android hardware back button
 * pops the stack instead of killing the app.
 */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { useDemoTheme } from './theme';

/** Two screens is the whole information architecture: an index and a demo.
 *  See `DemoGallery.tsx` for why there is no category screen in between. */
export type Route = { readonly name: 'home' } | { readonly name: 'demo'; readonly id: string };

export interface DemoNav {
  /** The top of the stack — what is on screen right now. */
  readonly route: Route;
  /** 1 at home. Anything above that is poppable. */
  readonly depth: number;
  readonly openDemo: (id: string) => void;
  readonly pop: () => void;
}

const HOME_STACK: readonly Route[] = [{ name: 'home' }];

/**
 * The stack, plus the Android back-button subscription.
 *
 * `onExitHome` is what hardware back does when there is nothing left to pop.
 * The bare-rn gallery passes a handler that returns to the paint-gate fixture
 * screens; the Expo gallery passes nothing, so back at home falls through to
 * the platform default of leaving the app.
 *
 * The subscription is re-registered whenever the stack changes, which is
 * deliberate rather than an oversight: `BackHandler.addEventListener` is a
 * plain array push, re-registering costs nothing measurable at navigation
 * frequency, and it keeps the handler reading the CURRENT stack instead of a
 * ref written during render.
 */
export function useDemoNav(options?: { readonly onExitHome?: () => void }): DemoNav {
  const [stack, setStack] = useState<readonly Route[]>(HOME_STACK);
  const onExitHome = options?.onExitHome;

  useEffect(() => {
    const onHardwareBack = (): boolean => {
      if (stack.length > 1) {
        setStack(stack.slice(0, -1));
        return true;
      }
      if (onExitHome !== undefined) {
        onExitHome();
        return true;
      }
      // Not handled: the platform does whatever it would have done, which on
      // Android means leaving the app. Returning `true` here would trap the
      // reader inside the gallery with no way out.
      return false;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
    return () => subscription.remove();
  }, [stack, onExitHome]);

  return {
    route: stack[stack.length - 1] ?? { name: 'home' },
    depth: stack.length,
    openDemo: (id: string) => setStack((current) => [...current, { name: 'demo', id }]),
    pop: () => setStack((current) => (current.length > 1 ? current.slice(0, -1) : current)),
  };
}

/**
 * The one bar every gallery screen wears.
 *
 * A hairline rule and a text-only back affordance: rule 1 of `theme.ts` —
 * chrome is text or a hairline-bordered surface, never a filled block that
 * could be read as the library's output.
 */
export function NavBar({
  title,
  onBack,
  backLabel = 'Demos',
  trailing,
}: {
  /** Centre-left title. Usually the demo's own title, or the app's name. */
  readonly title: string;
  /** Omitted at the root of the stack, which is what hides the chevron. */
  readonly onBack?: () => void;
  readonly backLabel?: string;
  /** Optional right-hand affordance (the bare-rn gallery puts its exit here). */
  readonly trailing?: ReactNode;
}): React.JSX.Element {
  const t = useDemoTheme();

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: t.color.surface,
          borderBottomColor: t.color.line,
          borderBottomWidth: t.border.hairline,
          paddingHorizontal: t.space.lg,
          gap: t.space.md,
        },
      ]}
    >
      {onBack === undefined ? null : (
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel="demo-back"
          testID="demo-back"
          onPress={onBack}
          hitSlop={8}
          style={styles.back}
        >
          <Text style={[t.type.label, { color: t.color.accent }]}>{`‹  ${backLabel}`}</Text>
        </Pressable>
      )}
      <Text numberOfLines={1} style={[t.type.label, styles.title, { color: t.color.ink }]}>
        {title}
      </Text>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
  },
  back: {
    justifyContent: 'center',
  },
  title: {
    flex: 1,
  },
});
