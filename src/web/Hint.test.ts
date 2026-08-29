// src/web/Hint.test.ts
//
// `<AutoSkeleton.Hint>` — the web half of the typed-hint channel, added to
// buy back API symmetry with `src/native/Hint.tsx` after NFR-6 was revised
// 8 kB -> 9 kB (spec.md NFR-6, second revision). Mirrors
// `test/native/hint.test.ts` structurally: `Hint` depends only on `react`'s
// `Children`/`cloneElement`, so it is exercised as a plain function against
// synthetic elements, with no DOM/Playwright harness needed for this
// mechanism-level proof. Real DOM consultation of the stamped attribute is
// already covered by `test/web/dom-sensor.spec.ts`'s
// `data-autoskeleton-radius` suite (the SAME attribute this component
// stamps) plus `test/web/auto-skeleton.spec.ts`'s `radiusSourceHistogram`
// E2E case.

import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { HINT_ID_ATTRIBUTE, HINT_RADIUS_ATTRIBUTE } from './dom-sensor';
import { Hint } from './Hint';

interface ClonedElement {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
}

describe('Hint (web) — typed-hint channel (src/web/Hint.tsx)', () => {
  it('clones the single child, stamping the data-autoskeleton-id attribute with the given id', () => {
    const child = createElement('div', { foo: 'bar' });
    const result = Hint({ id: 'row-title', children: child }) as unknown as ClonedElement;

    expect(result.type).toBe('div');
    expect(result.props[HINT_ID_ATTRIBUTE]).toBe('row-title');
    expect(result.props.foo).toBe('bar');
  });

  it('stamps data-autoskeleton-radius (the existing self-sufficient channel) when radius is provided', () => {
    const child = createElement('div');
    const result = Hint({ id: 'avatar', radius: 24, children: child }) as unknown as ClonedElement;

    expect(result.props[HINT_RADIUS_ATTRIBUTE]).toBe(24);
  });

  it('does not stamp data-autoskeleton-radius when radius is omitted', () => {
    const child = createElement('div');
    const result = Hint({ id: 'plain', children: child }) as unknown as ClonedElement;

    expect(result.props[HINT_RADIUS_ATTRIBUTE]).toBeUndefined();
  });

  it('overwrites a data-autoskeleton-radius the child already set (documented cloneElement override, same constraint as native)', () => {
    const child = createElement('div', { [HINT_RADIUS_ATTRIBUTE]: 4 });
    const result = Hint({ id: 'row-title', radius: 40, children: child }) as unknown as ClonedElement;

    expect(result.props[HINT_RADIUS_ATTRIBUTE]).toBe(40);
  });

  it('throws (React.Children.only contract) when given zero or multiple children', () => {
    expect(() => Hint({ id: 'x', children: [] })).toThrow();
    expect(() => Hint({ id: 'x', children: [createElement('div'), createElement('div')] })).toThrow();
  });
});
