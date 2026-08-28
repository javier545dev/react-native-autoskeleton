import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandoffController } from './handoff';

// Task 1.7 (tasks.md Phase 1): emits the handoffMs/handoffReason split
// consumed by `onMetrics` (wired in task 1.8) — makes REQ-IMG-2/ADR-16
// testable before any renderer exists. 100% branch coverage required
// (plan.md §7 unit-table gate).

const HANDOFF_TIMEOUT_MS = 250;
const HANDOFF_FADE_MS = 120;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('HandoffController defaults', () => {
  it('defaults handoffTimeoutMs to 250 and handoffFadeMs to 120 (ASSUMPTION plan.md §11.8)', async () => {
    const controller = createHandoffController({ expectsSuccessor: true });
    controller.requestHandoff();
    vi.advanceTimersByTime(HANDOFF_TIMEOUT_MS - 1);
    expect(controller.phase).toBe('placeholder'); // not yet timed out
    vi.advanceTimersByTime(1); // exactly at the 250ms default -> timeout fires, fade begins
    vi.advanceTimersByTime(HANDOFF_FADE_MS);
    await controller.settled;
    expect(controller.handoffReason).toBe('timeout');
  });
});

describe('HandoffController — displayDurationMs stamped at requestHandoff(), not teardown', () => {
  it('stamps displayDurationMs the instant requestHandoff() is called and never changes it again', async () => {
    const controller = createHandoffController({ expectsSuccessor: true });
    vi.advanceTimersByTime(500); // skeleton visible for 500ms before isLoading flips false
    controller.requestHandoff();
    const stampedImmediately = controller.displayDurationMs;
    expect(stampedImmediately).toBe(500);

    vi.advanceTimersByTime(HANDOFF_TIMEOUT_MS + HANDOFF_FADE_MS);
    await controller.settled;
    // Overlay teardown happened long after requestHandoff(); displayDurationMs must be unchanged.
    expect(controller.displayDurationMs).toBe(500);
  });
});

describe('HandoffController — successor-painted path', () => {
  it('settles with successor-painted when notifyPainted() fires before the timeout', async () => {
    const controller = createHandoffController({ expectsSuccessor: true });
    controller.requestHandoff();
    vi.advanceTimersByTime(30);
    controller.notifyPainted();
    expect(controller.phase).toBe('placeholder'); // fading, not yet torn down
    vi.advanceTimersByTime(HANDOFF_FADE_MS);
    const reason = await controller.settled;
    expect(reason).toBe('successor-painted');
    expect(controller.phase).toBe('content');
    expect(controller.handoffMs).toBe(30 + HANDOFF_FADE_MS);
  });
});

describe('HandoffController — timeout path', () => {
  it('settles with timeout when no successor signals within handoffTimeoutMs', async () => {
    const controller = createHandoffController({ expectsSuccessor: true });
    controller.requestHandoff();
    vi.advanceTimersByTime(HANDOFF_TIMEOUT_MS);
    vi.advanceTimersByTime(HANDOFF_FADE_MS);
    const reason = await controller.settled;
    expect(reason).toBe('timeout');
    expect(controller.handoffMs).toBe(HANDOFF_TIMEOUT_MS + HANDOFF_FADE_MS);
  });
});

describe('HandoffController — no-successor immediate fade', () => {
  it('begins the fade immediately (never waits for handoffTimeoutMs) when no successor is expected', async () => {
    const controller = createHandoffController(); // expectsSuccessor defaults to false
    controller.requestHandoff();
    vi.advanceTimersByTime(HANDOFF_FADE_MS - 1);
    expect(controller.phase).toBe('placeholder'); // still fading
    vi.advanceTimersByTime(1);
    const reason = await controller.settled;
    expect(reason).toBe('no-successor');
    expect(controller.handoffMs).toBe(HANDOFF_FADE_MS);
  });
});

describe('HandoffController — idempotency', () => {
  it('ignores a second requestHandoff() call without restamping displayDurationMs', () => {
    const controller = createHandoffController({ expectsSuccessor: true });
    vi.advanceTimersByTime(100);
    controller.requestHandoff();
    vi.advanceTimersByTime(200);
    controller.requestHandoff(); // second call must be a no-op
    expect(controller.displayDurationMs).toBe(100);
  });

  it('ignores notifyPainted() called before requestHandoff()', () => {
    const controller = createHandoffController({ expectsSuccessor: true });
    controller.notifyPainted(); // too early: still in 'skeleton' phase
    expect(controller.phase).toBe('skeleton');
    expect(controller.handoffReason).toBeUndefined();
  });

  it('ignores a second notifyPainted() call while already fading', async () => {
    const controller = createHandoffController({ expectsSuccessor: true });
    controller.requestHandoff();
    controller.notifyPainted();
    controller.notifyPainted(); // second call, still mid-fade: must be a no-op
    vi.advanceTimersByTime(HANDOFF_FADE_MS);
    const reason = await controller.settled;
    expect(reason).toBe('successor-painted');
    expect(controller.handoffMs).toBe(HANDOFF_FADE_MS);
  });

  it('ignores notifyPainted() called after the controller has already settled', async () => {
    const controller = createHandoffController(); // no-successor, immediate fade
    controller.requestHandoff();
    vi.advanceTimersByTime(HANDOFF_FADE_MS);
    await controller.settled;
    expect(controller.phase).toBe('content');
    controller.notifyPainted(); // must be a silent no-op
    expect(controller.handoffReason).toBe('no-successor');
  });
});

describe('HandoffController — displayDurationMs + handoffMs ≈ wall time invariant', () => {
  it('sums to the exact elapsed time from controller creation to settlement, under fake-timer control', async () => {
    const controller = createHandoffController({ expectsSuccessor: true });
    vi.advanceTimersByTime(400); // skeleton-visible duration
    controller.requestHandoff();
    vi.advanceTimersByTime(50);
    controller.notifyPainted();
    vi.advanceTimersByTime(HANDOFF_FADE_MS);
    await controller.settled;

    const totalWallTimeMs = 400 + 50 + HANDOFF_FADE_MS;
    expect(controller.displayDurationMs! + controller.handoffMs!).toBe(totalWallTimeMs);
  });
});

describe('HandoffController — custom handoffTimeoutMs / handoffFadeMs overrides', () => {
  it('honors explicit overrides instead of the 250/120 defaults', async () => {
    const controller = createHandoffController({
      expectsSuccessor: true,
      handoffTimeoutMs: 50,
      handoffFadeMs: 10,
    });
    controller.requestHandoff();
    vi.advanceTimersByTime(50);
    vi.advanceTimersByTime(10);
    const reason = await controller.settled;
    expect(reason).toBe('timeout');
    expect(controller.handoffMs).toBe(60);
  });
});

describe('HandoffController — subscribe', () => {
  it('notifies subscribers on phase transitions and stops after unsubscribe', async () => {
    const controller = createHandoffController(); // no-successor
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    controller.requestHandoff();
    expect(listener).toHaveBeenCalledWith('placeholder', undefined);
    unsubscribe();
    vi.advanceTimersByTime(HANDOFF_FADE_MS);
    await controller.settled;
    expect(listener).toHaveBeenCalledTimes(1); // the final settle notification was unsubscribed
  });
});
