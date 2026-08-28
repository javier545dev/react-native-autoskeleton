// src/web/DebugOverlay.tsx
//
// tasks.md 2.4 — web `debugOverlay` (REQ-OBS-OVERLAY-1). Outlines every
// detected shape with its index, source type, and cache hit/miss badge, so a
// developer can visually spot a "missed node" (no outline over a suspected
// element is itself the diagnostic signal). Dev-build only: `AutoSkeleton`
// (task 2.3) already gates mounting this component on
// `process.env.NODE_ENV !== 'production'`, which a real bundler's dead-code
// elimination tree-shakes away entirely in production (verified by task
// 2.5's packaging test).

import { SHAPE_SOURCES } from './dom-sensor';
import { decodeWire } from '../core/wire';
import type { ShapeSnapshot } from '../core/types';

export interface DebugOverlayProps {
  readonly snapshot: ShapeSnapshot;
  readonly cacheHit: boolean;
}

const OUTLINE_COLOR = '#ff00aa';

export function DebugOverlay(props: DebugOverlayProps): React.JSX.Element {
  const decoded = decodeWire(props.snapshot.data);
  const badge = props.cacheHit ? 'HIT' : 'MISS';

  return (
    <div className="askl-debug-overlay" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {decoded.shapes.map((shape, index) => {
        const sourceCode = props.snapshot.sources?.[index];
        const source = sourceCode !== undefined ? (SHAPE_SOURCES[sourceCode] ?? 'unknown') : 'unknown';
        return (
          <div
            key={index}
            data-askl-debug-shape={index}
            data-askl-debug-source={source}
            data-askl-debug-cache={badge}
            style={{
              position: 'absolute',
              left: shape.x,
              top: shape.y,
              width: shape.w,
              height: shape.h,
              outline: `1px solid ${OUTLINE_COLOR}`,
              boxSizing: 'border-box',
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: -14,
                left: 0,
                fontSize: 10,
                lineHeight: '14px',
                color: '#fff',
                background: OUTLINE_COLOR,
                padding: '0 3px',
                whiteSpace: 'nowrap',
              }}
            >
              {index} {source} {badge}
            </span>
          </div>
        );
      })}
    </div>
  );
}
