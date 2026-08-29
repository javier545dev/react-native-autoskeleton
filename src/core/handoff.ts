// src/core/handoff.ts
//
// plan.md §3.8 / ADR-16: the phase-1 -> phase-2 handoff controller. Mechanism
// that prevents the flash — reveal-before-hide, never hide-then-reveal: on
// `requestHandoff()` the content is considered revealed underneath the still-
// painted overlay, the overlay is retained until `notifyPainted()` fires or
// `handoffTimeoutMs` elapses, then cross-fades out over `handoffFadeMs`. There
// is no instant at which neither the skeleton nor the successor is painted.
//
// Observability: this module produces the `handoffMs`/`handoffReason` split
// that `assembleMetrics` (task 1.8) folds into `onMetrics` — makes REQ-IMG-2
// and ADR-16 testable before any renderer exists. This task performs no
// runtime console emission itself.
// Performance: `displayDurationMs + handoffMs` MUST equal the wall-clock time
// from controller creation to settlement — asserted under fake-timer control
// in handoff.test.ts.

import type { HandoffReason } from './types';

export type SkeletonPipelinePhase = 'skeleton' | 'placeholder' | 'content';

/** Describes an image-like leaf found by a Sensor. `autoskeleton` uses this
 *  ONLY to decide handoff behaviour — it never reads, decodes, or renders
 *  image data, and it never imports an image component (ADR-16). */
export interface ImageLeafDescriptor {
  readonly nodeId: string;
  readonly shapeIndex: number;
  /** true when the wrapped component advertises its own phase-2 placeholder
   *  (expo-image `placeholder`, FastImage, an `<img>` with an LQIP/`src`
   *  already set). */
  readonly hasOwnPlaceholder: boolean;
}

export interface HandoffOptions {
  /** upper bound on how long the skeleton is retained past isLoading=false */
  readonly handoffTimeoutMs: number; // default 250 (ASSUMPTION plan.md §11.8)
  /** overlay cross-fade duration once the successor has painted */
  readonly handoffFadeMs: number; // default 120 (ASSUMPTION plan.md §11.8)
}

export const DEFAULT_HANDOFF_TIMEOUT_MS = 250;
export const DEFAULT_HANDOFF_FADE_MS = 120;

export interface HandoffController {
  readonly phase: SkeletonPipelinePhase;
  /** Stamped the instant `requestHandoff()` is called; `undefined` before
   *  that. Deliberately decoupled from overlay teardown (ADR-16). */
  readonly displayDurationMs: number | undefined;
  /** The full wait-plus-fade handoff tail; `undefined` until settlement. */
  readonly handoffMs: number | undefined;
  readonly handoffReason: HandoffReason | undefined;
  /** Called by AutoSkeleton when `isLoading` flips false. Ends phase 1 for
   *  metrics purposes IMMEDIATELY (stamps `displayDurationMs`) while the
   *  overlay may still be on screen. Idempotent: a second call is a no-op. */
  requestHandoff(): void;
  /** Called by the wrapped subtree once its placeholder or content has
   *  painted its first frame. Idempotent; a call before `requestHandoff()`
   *  or after settlement is ignored. */
  notifyPainted(nodeId?: string): void;
  /** Resolves once the overlay has been torn down (phase reaches 'content'). */
  readonly settled: Promise<HandoffReason>;
  subscribe(listener: (phase: SkeletonPipelinePhase, reason?: HandoffReason) => void): () => void;
}

export interface CreateHandoffControllerOptions extends Partial<HandoffOptions> {
  /** Whether a successor is expected to signal its own paint via
   *  `notifyPainted()`. Defaults to `false`: with no signal wired, the
   *  handoff fades immediately rather than waiting on a timeout that will
   *  never be cleared by anything. */
  readonly expectsSuccessor?: boolean;
  /** Injectable clock for deterministic tests; defaults to `Date.now`. */
  readonly now?: () => number;
}

/** Creates a fresh `HandoffController`. One instance per `AutoSkeleton`
 *  mount; `createdAt` (used to compute `displayDurationMs`) is captured at
 *  construction time, which callers should treat as "first skeleton frame
 *  painted". */
export function createHandoffController(
  options: CreateHandoffControllerOptions = {},
): HandoffController {
  const handoffTimeoutMs = options.handoffTimeoutMs ?? DEFAULT_HANDOFF_TIMEOUT_MS;
  const handoffFadeMs = options.handoffFadeMs ?? DEFAULT_HANDOFF_FADE_MS;
  const expectsSuccessor = options.expectsSuccessor ?? false;
  const now = options.now ?? (() => Date.now());

  const createdAt = now();
  let phase: SkeletonPipelinePhase = 'skeleton';
  let displayDurationMs: number | undefined;
  let handoffMs: number | undefined;
  let handoffReason: HandoffReason | undefined;
  let handoffStartedAt: number | undefined;
  let waitTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let painted = false;

  const listeners = new Set<(phase: SkeletonPipelinePhase, reason?: HandoffReason) => void>();
  let settleResolve!: (reason: HandoffReason) => void;
  const settled = new Promise<HandoffReason>((resolve) => {
    settleResolve = resolve;
  });

  function notifyListeners(): void {
    for (const listener of listeners) {
      listener(phase, handoffReason);
    }
  }

  /** Begins the cross-fade for a known outcome. Cancels a still-pending wait
   *  timeout (the successor-painted-before-timeout case); a no-op when there
   *  was none (the immediate no-successor case, or the timeout callback
   *  itself, which is already past firing).
   *
   *  Adversarial-review defect (2026-08-29): idempotent for the WHOLE cycle.
   *  `notifyPainted()`'s own `phase !== 'placeholder'` guard cannot close
   *  this window, because `phase` stays `'placeholder'` for the full
   *  `handoffFadeMs` cross-fade — so a fade already begun for one reason
   *  could be re-begun for another (timeout fires, THEN the successor
   *  paints; or `expectsSuccessor: false` fades immediately and a paint
   *  signal lands mid-fade). The live `handoffReason` getter then reported a
   *  different outcome than `settled` resolved with, because `settleResolve`
   *  captures its own `reason` argument while the getter reads the last
   *  write — and a second, orphaned fade timer rewrote `handoffMs` and
   *  re-notified every subscriber after teardown. `web/AutoSkeleton.tsx`'s
   *  `usePaintDetectionHeuristic` guarded exactly ONE sub-case of this at
   *  its own call site; this is the same fix at the source, covering every
   *  caller on every platform. `handoffReason` is the cycle's commit point:
   *  once set, the outcome is decided. */
  function beginFade(reason: HandoffReason): void {
    if (handoffReason !== undefined) {
      return;
    }
    handoffReason = reason;
    if (waitTimeoutHandle !== undefined) {
      clearTimeout(waitTimeoutHandle);
      waitTimeoutHandle = undefined;
    }
    setTimeout(() => {
      handoffMs = now() - handoffStartedAt!;
      phase = 'content';
      notifyListeners();
      settleResolve(reason);
    }, handoffFadeMs);
  }

  return {
    get phase() {
      return phase;
    },
    get displayDurationMs() {
      return displayDurationMs;
    },
    get handoffMs() {
      return handoffMs;
    },
    get handoffReason() {
      return handoffReason;
    },
    requestHandoff(): void {
      if (phase !== 'skeleton') {
        return;
      }
      displayDurationMs = now() - createdAt;
      handoffStartedAt = now();
      phase = 'placeholder';
      notifyListeners();

      if (!expectsSuccessor) {
        beginFade('no-successor');
        return;
      }
      waitTimeoutHandle = setTimeout(() => {
        beginFade('timeout');
      }, handoffTimeoutMs);
    },
    notifyPainted(): void {
      if (phase !== 'placeholder' || painted) {
        return;
      }
      painted = true;
      beginFade('successor-painted');
    },
    settled,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
