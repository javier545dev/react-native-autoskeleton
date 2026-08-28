import { describe, expect, it } from 'vitest';
import { synthesizeLines } from './lines';

// Task 1.4 (tasks.md Phase 1): Observability — tags synthesized shapes
// `source: 'synthetic-line'` in the dev sidecar (§4.4); asserted below.
// Performance: N/A standalone (folded into traversal budget once called from
// sensors in Phase 2-4).

describe('synthesizeLines — no-hint default', () => {
  it('derives the line count from height / lineHeight when no hint is given', () => {
    const lines = synthesizeLines({ x: 0, y: 0, w: 200, h: 60, lineHeight: 20 });
    expect(lines).toHaveLength(3);
  });

  it('rounds to at least one line for a collapsed node shorter than one lineHeight', () => {
    const lines = synthesizeLines({ x: 0, y: 0, w: 200, h: 5, lineHeight: 20 });
    expect(lines).toHaveLength(1);
  });
});

describe('synthesizeLines — hinted count', () => {
  it('honors an explicit `lines` hint over the height-derived default', () => {
    const lines = synthesizeLines({ x: 0, y: 0, w: 200, h: 60, lineHeight: 20, lines: 5 });
    expect(lines).toHaveLength(5);
  });
});

describe('synthesizeLines — width bounds', () => {
  it('keeps every synthesized line width within 60%-85% of the collapsed width', () => {
    const w = 240;
    const lines = synthesizeLines({ x: 0, y: 0, w, h: 100, lineHeight: 20, lines: 5 });
    for (const line of lines) {
      expect(line.w).toBeGreaterThanOrEqual(w * 0.6 - 1e-9);
      expect(line.w).toBeLessThanOrEqual(w * 0.85 + 1e-9);
    }
  });

  it('does not produce identical widths for every line (real width variance)', () => {
    const lines = synthesizeLines({ x: 0, y: 0, w: 240, h: 100, lineHeight: 20, lines: 4 });
    const widths = new Set(lines.map((l) => l.w));
    expect(widths.size).toBeGreaterThan(1);
  });
});

describe('synthesizeLines — height equality', () => {
  it('gives every line exactly `lineHeight` as its height', () => {
    const lines = synthesizeLines({ x: 0, y: 0, w: 200, h: 60, lineHeight: 20, lines: 3 });
    expect(lines.every((l) => l.h === 20)).toBe(true);
  });

  it('stacks lines vertically at consecutive lineHeight offsets from y', () => {
    const lines = synthesizeLines({ x: 0, y: 100, w: 200, h: 60, lineHeight: 20, lines: 3 });
    expect(lines.map((l) => l.y)).toEqual([100, 120, 140]);
  });
});

describe('synthesizeLines — dev sidecar tagging', () => {
  it('tags every synthesized shape source: "synthetic-line"', () => {
    const lines = synthesizeLines({ x: 0, y: 0, w: 200, h: 40, lineHeight: 20 });
    expect(lines.every((l) => l.source === 'synthetic-line')).toBe(true);
  });
});
