// test/packaging/core-styling-agnostic.test.ts
//
// tasks.md 7.2 (spec REQ-THEME-3): "the core sensor MUST remain agnostic to
// the active styling system — it reads rendered frames and computed styles
// only, never className strings." This is the grep-level static assertion
// the task explicitly asks for: cheap, and exactly the kind of invariant
// that erodes silently once a theming interop exists elsewhere in the tree
// and it becomes tempting to take a shortcut inside `src/core/` itself.
//
// Scans real, on-disk `src/core/**/*.ts` source text (never a bundler
// import graph — the point is to catch the SOURCE TEXT itself referencing
// `className`, before any bundling/tree-shaking could hide or reshape it).
// Uses a plain recursive `readdirSync` walk (no extra glob dependency),
// matching `test/packaging/entries.test.ts`'s own `walkFiles` convention.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CORE_DIR = path.resolve(__dirname, '../../src/core');

function walkSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkSourceFiles(abs));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      out.push(abs);
    }
  }
  return out;
}

/** Strips `//` and `/* *‍/` comments (naive but sufficient for this repo's
 *  real TS source — the point is telling apart "a doc comment EXPLAINING
 *  REQ-THEME-3" from "code that actually references `className`", not
 *  building a full tokenizer). Several `src/core/` files legitimately
 *  document this exact constraint in prose (e.g. "className is NEVER
 *  parsed") — a naive raw-text grep would flag its own compliance
 *  documentation as a violation, which is the wrong assertion. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('src/core/ never references className (REQ-THEME-3, tasks.md 7.2)', () => {
  it('no source file under src/core/ contains the identifier "className" outside of comments', () => {
    const coreFiles = walkSourceFiles(CORE_DIR);
    // Sanity: the walk actually found the real tree, not an empty/wrong dir —
    // guards this assertion against silently passing vacuously.
    expect(coreFiles.length).toBeGreaterThan(10);

    const offenders = coreFiles.filter((file) => /\bclassName\b/.test(stripComments(readFileSync(file, 'utf8'))));
    expect(offenders).toEqual([]);
  });

  it('sanity: the comment-stripping regex itself would catch a real violation, not just documentation', () => {
    // Proves the assertion above is non-vacuous — it is not merely "no file
    // happens to mention className", it genuinely fails when className is
    // referenced as CODE, not prose.
    const fakeViolation = `
      // className is NEVER parsed here (a compliant comment)
      export function leafShape(el: { className: string }) {
        return el.className;
      }
    `;
    expect(/\bclassName\b/.test(stripComments(fakeViolation))).toBe(true);

    const fakeCompliant = `
      // typed-prop hints only; className is NEVER parsed (spec REQ-THEME-3)
      export function leafShape(el: { computedStyle: unknown }) {
        return el.computedStyle;
      }
    `;
    expect(/\bclassName\b/.test(stripComments(fakeCompliant))).toBe(false);
  });
});
