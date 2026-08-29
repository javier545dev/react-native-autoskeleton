// test/web/helpers/ax.ts
//
// Reads the ACCESSIBILITY TREE Chromium itself computes, over CDP
// (`Accessibility.getPartialAXTree`) — not the DOM, and not a re-implementation
// of the ARIA algorithm.
//
// Why this and not `closest('[aria-hidden="true"]')` (what
// `auto-skeleton.spec.ts` used before): an attribute query proves an ATTRIBUTE
// is present, which is a statement about our own markup. The question a
// screen-reader defect actually asks is whether the BROWSER decided to expose
// the node, and that depends on more than one attribute (`display: contents`
// ancestors — which this component uses — `inert`, `visibility`, presentational
// role inheritance). `AXNode.ignored` + `ignoredReasons` is the browser's
// answer verbatim, with the REASON attached, so a test can assert not merely
// "hidden" but "hidden BECAUSE of an aria-hidden subtree" — which is what makes
// a fix in the right place distinguishable from an accident.
//
// `page.accessibility.snapshot()` is NOT used: it has been removed from
// `@playwright/test` (absent from `playwright-core/types/types.d.ts` at the
// pinned 1.62.1). CDP is the supported route, and this repo's Playwright
// project is Chromium-only (`playwright.config.ts`), so there is no
// portability cost.

import type { CDPSession, Page } from '@playwright/test';

export interface AxState {
  /** false when the selector matched no DOM node at all. */
  readonly present: boolean;
  /** Chromium's own verdict: true means assistive technology never reaches it. */
  readonly ignored: boolean;
  /** e.g. `['ariaHiddenSubtree']` — WHY it was ignored. */
  readonly ignoredReasons: readonly string[];
  /** The computed accessible name. Only roles that take their name from
   *  contents (heading, link, button, ...) produce a non-empty value — a
   *  `<p>` computes `''`, which is a property of ARIA, not a bug here. */
  readonly name: string;
  /** The computed ARIA role. */
  readonly role: string;
  /** Effective `aria-busy` for this node: Chromium attaches the `busy`
   *  property only to the element that DECLARES it, but per ARIA the state
   *  applies to that element's whole subtree, which is what a screen reader
   *  acts on. So this walks the node's AX ancestor chain and reports the
   *  nearest declaration — letting a test ask "is the region containing this
   *  content busy?" instead of "did we put the attribute on this exact
   *  element?", which would just be asserting our own markup shape back at
   *  ourselves. */
  readonly busy: boolean;
}

const sessions = new WeakMap<Page, Promise<CDPSession>>();

function sessionFor(page: Page): Promise<CDPSession> {
  const existing = sessions.get(page);
  if (existing) {
    return existing;
  }
  const created = page
    .context()
    .newCDPSession(page)
    .then(async (client) => {
      await client.send('DOM.enable');
      await client.send('Accessibility.enable');
      return client;
    });
  sessions.set(page, created);
  return created;
}

interface RawAxProperty {
  readonly name: string;
  readonly value?: { readonly value?: unknown };
}

interface RawAxNode {
  readonly nodeId: string;
  readonly parentId?: string;
  readonly backendDOMNodeId?: number;
  readonly ignored?: boolean;
  readonly ignoredReasons?: readonly RawAxProperty[];
  readonly name?: { readonly value?: unknown };
  readonly role?: { readonly value?: unknown };
  readonly properties?: readonly RawAxProperty[];
}

const ABSENT: AxState = {
  present: false,
  ignored: true,
  ignoredReasons: [],
  name: '',
  role: '',
  busy: false,
};

/** Chromium reports boolean AX property values as `true` or as `1` depending on
 *  the property. Normalise both, and never coerce `undefined` to `false`
 *  silently at the call site. */
function isTruthyAxValue(property: RawAxProperty | undefined): boolean {
  const value = property?.value?.value;
  return value === true || value === 1;
}

/** Chromium's accessibility verdict for the single node matching `selector`.
 *  The document is re-fetched on every call because CDP `nodeId`s are
 *  invalidated by the React re-renders these tests deliberately drive. */
export async function axStateOf(page: Page, selector: string): Promise<AxState> {
  const client = await sessionFor(page);
  const { root } = (await client.send('DOM.getDocument', { depth: -1 })) as { root: { nodeId: number } };
  const { nodeId } = (await client.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector,
  })) as { nodeId: number };
  if (!nodeId) {
    return ABSENT;
  }
  // The target is identified by its BACKEND node id, never by position in the
  // returned array: with `fetchRelatives: true` the response also carries
  // children, siblings and the whole ancestor chain, in no contractual order.
  const { node } = (await client.send('DOM.describeNode', { nodeId })) as {
    node: { backendNodeId: number };
  };
  const { nodes } = (await client.send('Accessibility.getPartialAXTree', {
    nodeId,
    fetchRelatives: true,
  })) as { nodes: readonly RawAxNode[] };

  const byId = new Map(nodes.map((axNode) => [axNode.nodeId, axNode]));
  const target = nodes.find((axNode) => axNode.backendDOMNodeId === node.backendNodeId);
  if (!target) {
    return ABSENT;
  }

  let busy = false;
  for (let cursor: RawAxNode | undefined = target; cursor; cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined) {
    const declared = cursor.properties?.find((property) => property.name === 'busy');
    if (declared !== undefined) {
      busy = isTruthyAxValue(declared);
      break;
    }
  }

  return {
    present: true,
    ignored: target.ignored === true,
    ignoredReasons: (target.ignoredReasons ?? []).map((reason) => reason.name),
    name: typeof target.name?.value === 'string' ? target.name.value : '',
    role: typeof target.role?.value === 'string' ? target.role.value : '',
    busy,
  };
}
