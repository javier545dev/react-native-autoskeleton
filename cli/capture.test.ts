// cli/capture.test.ts
//
// tasks.md 8.1: RED→GREEN `cli/capture.ts`. Threat-matrix RED tests written
// FIRST (plan.md §8, the one applicable row: "Capture-CLI subprocess & route
// handling"), then functional tests: registry-driven capture over real
// routes x width buckets x [ltr,rtl], using a real headless Chromium (never
// a hand-rolled DOM double) against a tiny local fixture HTTP server — never
// the full example apps, which is task 8.3's Next.js E2E concern.

import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CaptureFailedError, runCapture } from './capture';

const FIXTURE_PAGES: Record<string, string> = {
  '/dashboard': `<!doctype html><html><head><style>*{box-sizing:border-box;margin:0}</style></head><body>
    <div id="autoskeleton-capture-root" style="width:100%;">
      <div style="width:200px;height:40px;background:#ccc;" data-autoskeleton-id="title"></div>
      <div style="width:150px;height:20px;background:#ccc;" data-autoskeleton-ignore="true"></div>
      <div style="width:300px;height:80px;background:#ccc;"></div>
    </div>
  </body></html>`,
  '/empty': `<!doctype html><html><body><p>no capture root here</p></body></html>`,
  '/hangs': '__HANGS__',
};

let server: Server;
let baseURL: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const page = FIXTURE_PAGES[pathname];
    if (page === '__HANGS__') {
      // Deliberately never responds — exercises the navigation-timeout path.
      return;
    }
    if (page === undefined) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end(page);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected a TCP address');
  }
  baseURL = `http://127.0.0.1:${address.port}`;
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

describe('runCapture — threat matrix (plan.md §8)', () => {
  it('rejects a cross-origin route before launching a browser', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'askl-capture-'));
    await expect(
      runCapture({
        baseURL,
        registry: { dashboard: 'https://evil.example/steal' },
        outDir,
        widthBuckets: [360],
        directions: ['ltr'],
      }),
    ).rejects.toThrow(/origin/i);
    await rm(outDir, { recursive: true, force: true });
  });

  it('rejects a route containing ../ traversal before launching a browser', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'askl-capture-'));
    await expect(
      runCapture({
        baseURL,
        registry: { dashboard: '/../../etc/passwd' },
        outDir,
        widthBuckets: [360],
        directions: ['ltr'],
      }),
    ).rejects.toThrow(/traversal|\.\./i);
    await rm(outDir, { recursive: true, force: true });
  });

  it('passes a route with shell metacharacters through inertly and captures normally', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'askl-capture-'));
    const result = await runCapture({
      baseURL,
      registry: { dashboard: '/dashboard?x=$(rm -rf /)&y=`id`;echo pwned' },
      outDir,
      widthBuckets: [360],
      directions: ['ltr'],
    });
    expect(result.manifest.capturedKeys).toEqual(['dashboard']);
    await rm(outDir, { recursive: true, force: true });
  }, 30_000);

  it('a navigation timeout is a hard failure naming the offending skeletonKey, and non-zero-exit-worthy', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'askl-capture-'));
    let caught: unknown;
    try {
      await runCapture({
        baseURL,
        registry: { slowKey: '/hangs' },
        outDir,
        widthBuckets: [360],
        directions: ['ltr'],
        navigationTimeoutMs: 500,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CaptureFailedError);
    expect((caught as CaptureFailedError).skeletonKeys).toEqual(['slowKey']);
    expect((caught as Error).message).toContain('slowKey');
    await rm(outDir, { recursive: true, force: true });
  }, 30_000);

  it('an empty/partial capture (one key fails, another succeeds) never writes anything, leaving a previously good bundle untouched', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'askl-capture-'));

    // Seed outDir with a "previously good bundle".
    const goodResult = await runCapture({
      baseURL,
      registry: { dashboard: '/dashboard' },
      outDir,
      widthBuckets: [360],
      directions: ['ltr'],
    });
    const manifestBefore = await readFile(goodResult.report.manifestPath, 'utf8');

    // A mixed run: one good key, one that hangs past the timeout.
    await expect(
      runCapture({
        baseURL,
        registry: { dashboard: '/dashboard', slowKey: '/hangs' },
        outDir,
        widthBuckets: [360],
        directions: ['ltr'],
        navigationTimeoutMs: 500,
      }),
    ).rejects.toThrow();

    const manifestAfter = await readFile(goodResult.report.manifestPath, 'utf8');
    expect(manifestAfter).toBe(manifestBefore);
    await rm(outDir, { recursive: true, force: true });
  }, 60_000);

  it('a capture root that is missing on the page is a hard failure, not a silent empty snapshot', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'askl-capture-'));
    await expect(
      runCapture({
        baseURL,
        registry: { missingRoot: '/empty' },
        outDir,
        widthBuckets: [360],
        directions: ['ltr'],
      }),
    ).rejects.toThrow(/missingRoot/);
    await rm(outDir, { recursive: true, force: true });
  }, 30_000);
});

describe('runCapture — functional capture (registry x width buckets x direction)', () => {
  it('captures a real registry entry over 3 width buckets x [ltr,rtl] and writes manifest.json + bundle.css', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'askl-capture-'));
    const result = await runCapture({
      baseURL,
      registry: { dashboard: '/dashboard' },
      outDir,
      widthBuckets: [360, 768, 1280],
      directions: ['ltr', 'rtl'],
    });

    expect(result.manifest.capturedKeys).toEqual(['dashboard']);
    expect(result.manifest.entries).toHaveLength(6); // 3 buckets x 2 directions
    for (const bucket of [360, 768, 1280]) {
      for (const direction of ['ltr', 'rtl'] as const) {
        expect(
          result.manifest.entries.some((e) => e.widthBucket === bucket && e.direction === direction),
        ).toBe(true);
      }
    }

    const manifestOnDisk = JSON.parse(await readFile(result.report.manifestPath, 'utf8'));
    expect(manifestOnDisk.capturedKeys).toEqual(['dashboard']);
    const cssOnDisk = await readFile(result.report.cssBundlePath, 'utf8');
    expect(cssOnDisk).toContain('@media');

    await rm(outDir, { recursive: true, force: true });
  }, 30_000);

  it('respects <AutoSkeleton.Ignore> — a captured snapshot never contains shapes for an ignored subtree', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'askl-capture-'));
    const result = await runCapture({
      baseURL,
      registry: { dashboard: '/dashboard' },
      outDir,
      widthBuckets: [360],
      directions: ['ltr'],
    });

    const entry = result.manifest.entries[0]!;
    // The fixture's ignored node is 150x20; only the title (200x40) and the
    // trailing block (300x80) should survive as shapes. Decode the flat wire
    // array directly (slot 0 = VERSION, then x,y,w,h,r per shape).
    const shapeCount = (entry.snapshot.data.length - 1) / 5;
    expect(shapeCount).toBe(2);
    const heights = [];
    for (let i = 0; i < shapeCount; i++) {
      heights.push(entry.snapshot.data[1 + i * 5 + 3]);
    }
    expect(heights).not.toContain(20); // the ignored node's height never appears
    expect(heights).toContain(40);
    expect(heights).toContain(80);

    await rm(outDir, { recursive: true, force: true });
  }, 30_000);
});
