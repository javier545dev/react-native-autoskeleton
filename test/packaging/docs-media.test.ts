import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The README carried `<img src="docs/assets/cold-load.gif">` for as long as the
// visual section existed, and the file was never recorded. The README even said
// so in an HTML comment — "this tag renders broken until the file lands" — which
// is an honest note, not a gate: nothing failed, so nothing surfaced it, and on
// GitHub the page simply rendered a broken image icon.
//
// Every other reference in this repo is checked by something. Imports are
// checked by the typechecker, exports by `entries.test.ts`, workflow artifacts
// by `workflows.test.ts`. Markdown media was the one reference class with no
// checker at all, which is exactly why it was the one that rotted.
//
// This closes it for every local image reference in every tracked markdown
// file, in both syntaxes, resolved the way a renderer resolves it: relative to
// the FILE, not to the repo root. That distinction is the whole reason a naive
// check would have passed — `docs/theming.md` writes `assets/css-variables.png`
// while `README.md` writes `docs/assets/cold-load.gif`, and both are correct.
//
// Remote URLs (badges, shields) are deliberately out of scope: asserting them
// would make the suite fail on a network blip, which is a gate that fails for
// reasons unrelated to the repo.

const repoRoot = path.resolve(__dirname, '../..');

function markdownFiles(): string[] {
  const out = [path.join(repoRoot, 'README.md')];
  const docsDir = path.join(repoRoot, 'docs');
  if (existsSync(docsDir)) {
    for (const name of readdirSync(docsDir)) {
      if (name.endsWith('.md')) out.push(path.join(docsDir, name));
    }
  }
  return out.filter((f) => existsSync(f));
}

// `<img src="...">` and `![alt](...)`, which are the two forms this repo uses.
const HTML_SRC = /<img[^>]*\ssrc="([^"]+)"/g;
const MD_IMAGE = /!\[[^\]]*\]\(([^)\s]+)/g;

function localRefs(markdown: string): string[] {
  const refs: string[] = [];
  for (const re of [HTML_SRC, MD_IMAGE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(markdown)) !== null) {
      // `noUncheckedIndexedAccess` is on, and a capture group really can be
      // undefined for a pattern that matched without it — narrow rather than
      // assert, so a future pattern change cannot turn this into a crash.
      const ref = m[1];
      if (ref === undefined) continue;
      // Remote and inline references are somebody else's to keep alive.
      if (/^(https?:)?\/\//.test(ref) || ref.startsWith('data:')) continue;
      const withoutFragment = ref.split('#')[0];
      if (withoutFragment !== undefined) refs.push(withoutFragment);
    }
  }
  return refs;
}

describe('every local image a markdown file points at actually exists', () => {
  for (const file of markdownFiles()) {
    const rel = path.relative(repoRoot, file);
    it(`${rel}`, () => {
      const refs = localRefs(readFileSync(file, 'utf8'));
      const broken = refs.filter(
        // Resolved against the file's own directory, which is how GitHub and
        // every markdown renderer resolve a relative path.
        (ref) => !existsSync(path.resolve(path.dirname(file), ref))
      );
      expect(
        broken,
        `${rel} points at ${broken.length} file(s) that do not exist: ${broken.join(', ')}`
      ).toEqual([]);
    });
  }

  it('actually inspects some references (the gate is not vacuously green)', () => {
    const total = markdownFiles().reduce(
      (n, f) => n + localRefs(readFileSync(f, 'utf8')).length,
      0
    );
    // Without this, deleting every figure would leave the suite green and the
    // check would silently stop meaning anything.
    expect(total).toBeGreaterThan(0);
  });
});
