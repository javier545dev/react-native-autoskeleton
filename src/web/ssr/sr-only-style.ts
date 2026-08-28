// src/web/ssr/sr-only-style.ts
//
// Shared screen-reader-only inline style, used identically by the neutral
// block and the captured-key overlay so both branches of ADR-12's "same pure
// function on server and client" carry the exact same accessible-name markup.

import type { CSSProperties } from 'react';

export const SR_ONLY_STYLE: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
};
