// test/web/helpers/expo-web-app.ts
//
// tasks.md G.17: builds and serves the `examples/expo` app as a REAL Expo Web
// artifact, so `test/web/expo-web-export.spec.ts` can assert against the
// bytes a user actually deploys.
//
// WHY `expo export --platform web` AND NOT `expo start --web`. Both run
// Metro, so both exercise the same resolver conditions (`@expo/metro-config`
// gives web only `['browser']`, never `react-native` — the reason
// `exports['.']` must list `browser` first). The static export wins on three
// counts that matter for a gate:
//   1. It is the shipping artifact. `expo start` serves a dev bundle with a
//      different transform pipeline; a gate that only proves the dev server
//      works has not proven the deployed app works.
//   2. It is a finished file tree. `expo start` bundles lazily on first
//      request, holds an HMR websocket open and watches the filesystem —
//      three sources of CI flake, and a suite that flakes is a suite someone
//      eventually disables. This mirrors the choice `test/ssr/dashboard.spec
//      .ts` already made (`next build && next start`, never `next dev`, for
//      the verification phase).
//   3. It can be inspected as text before a browser is involved, which is
//      how the spec proves resolution landed on `index.web.js` rather than
//      inferring it from a screenshot.
//
// WHY THE LIBRARY IS MATERIALIZED FROM A FRESH `npm pack` RATHER THAN
// `npm install`ed. `examples/expo/package-lock.json` pins the integrity hash
// of the locally-built tarball. After a repack those bytes change, so a plain
// `npm install` either silently reinstalls STALE cached bytes under a fresh
// mtime, or (after a cache clean) hard-fails with EINTEGRITY — and rewriting
// the lockfile on every test run would churn a tracked file. Extracting the
// tarball this run just produced directly over
// `examples/expo/node_modules/autoskeleton` removes npm's cache from the
// loop entirely: the gate can only ever run against the bytes it just built.
// `npm pack` runs the `prepare` lifecycle script, so `lib/` is rebuilt from
// `src/` as part of packing (verified in `test/packaging/global-setup.ts` —
// `--ignore-scripts` does NOT suppress it in this npm version).

import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const EXPO_APP_DIR = path.join(REPO_ROOT, 'examples/expo');
/** Gitignored (`examples/expo/.gitignore` lists `dist/`). */
const EXPORT_DIR = path.join(EXPO_APP_DIR, 'dist');
const PACK_DIR = path.join(REPO_ROOT, '.pack-tmp-expo-web');
const INSTALLED_DIR = path.join(EXPO_APP_DIR, 'node_modules/autoskeleton');

export interface ExpoWebBuild {
  /** Absolute path to the exported static site. */
  readonly outDir: string;
  /** Absolute path of the single exported web JS bundle. */
  readonly bundlePath: string;
  /** The exported bundle's source text. */
  readonly bundleSource: string;
}

/** Packs the library from source and materializes the packed tarball into
 *  `examples/expo/node_modules/autoskeleton`, replacing whatever was there. */
function installFreshlyPackedLibrary(): void {
  rmSync(PACK_DIR, { recursive: true, force: true });
  mkdirSync(PACK_DIR, { recursive: true });
  execFileSync('npm', ['pack', '--pack-destination', PACK_DIR], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  const [filename] = readdirSync(PACK_DIR).filter((f) => f.endsWith('.tgz'));
  if (filename === undefined) {
    throw new Error(`npm pack produced no .tgz in ${PACK_DIR}`);
  }
  execFileSync('tar', ['-xzf', path.join(PACK_DIR, filename), '-C', PACK_DIR]);
  const extracted = path.join(PACK_DIR, 'package');
  if (!existsSync(extracted)) {
    throw new Error(`expected the extracted package at ${extracted}`);
  }
  rmSync(INSTALLED_DIR, { recursive: true, force: true });
  mkdirSync(path.dirname(INSTALLED_DIR), { recursive: true });
  execFileSync('cp', ['-R', extracted, INSTALLED_DIR]);
  rmSync(PACK_DIR, { recursive: true, force: true });
}

/** Full build: fresh library bytes into the example's `node_modules`, then a
 *  real `expo export --platform web`. */
export function buildExpoWebExport(): ExpoWebBuild {
  installFreshlyPackedLibrary();
  rmSync(EXPORT_DIR, { recursive: true, force: true });
  execFileSync(
    'npx',
    ['expo', 'export', '--platform', 'web', '--output-dir', EXPORT_DIR],
    { cwd: EXPO_APP_DIR, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, CI: '1' } },
  );

  const jsDir = path.join(EXPORT_DIR, '_expo/static/js/web');
  const bundles = existsSync(jsDir) ? readdirSync(jsDir).filter((f) => f.endsWith('.js')) : [];
  if (bundles.length !== 1) {
    throw new Error(
      `expected exactly one exported web bundle in ${jsDir}, found ${JSON.stringify(bundles)}`,
    );
  }
  const bundlePath = path.join(jsDir, bundles[0]!);
  return { outDir: EXPORT_DIR, bundlePath, bundleSource: readFileSync(bundlePath, 'utf8') };
}

export interface StaticServer {
  readonly baseURL: string;
  stop(): Promise<void>;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

/** Minimal static file server over the exported site. Binds port 0 so
 *  concurrent Playwright workers never collide on a fixed port. */
export function serveStatic(rootDir: string): Promise<StaticServer> {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const resolved = path.join(rootDir, relative);
    // Path-traversal guard: a request must resolve inside the served root.
    if (!resolved.startsWith(rootDir) || !existsSync(resolved) || !statSync(resolved).isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[path.extname(resolved)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(resolved).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseURL: `http://127.0.0.1:${port}`,
        stop: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
