// test/web/helpers/vite-app.ts
//
// tasks.md 7.1 (spec REQ-THEME-1), app-level half: process helpers that build
// `examples/vite` with ITS OWN production build command and serve the emitted
// `dist/` over `vite preview`. Deliberately mirrors `test/ssr/helpers/
// next-server.ts` — same shape, same readiness poll, same "resolve the app's
// own local binary rather than a globally installed one" rule.
//
// Why the real production build and not the dev server: Tailwind v4's
// compilation is a BUILD step. A dev-server run proves the plugin is wired;
// only the production build proves the emitted stylesheet a real user
// downloads carries the `@theme` tokens the skeleton's colours resolve
// through. `test/web/theme-cascade.spec.ts` already covers the compiler
// contract in isolation; this covers the app that ships it.

import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const VITE_APP_DIR = path.resolve(__dirname, '../../../examples/vite');
const VITE_BIN = path.join(VITE_APP_DIR, 'node_modules/.bin/vite');
const DIST_DIR = path.join(VITE_APP_DIR, 'dist');

export interface RunningServer {
  readonly baseURL: string;
  stop(): Promise<void>;
}

async function waitForReady(baseURL: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseURL);
      if (response.ok || response.status < 500) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`vite preview at ${baseURL} did not become ready within ${timeoutMs}ms: ${String(lastError)}`);
}

function stopProcess(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.killed) {
      resolve();
      return;
    }
    proc.once('exit', () => resolve());
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (proc.exitCode === null && !proc.killed) {
        proc.kill('SIGKILL');
      }
    }, 5000).unref();
  });
}

/** Runs the example app's OWN `npm run build` (`tsc -b && vite build`), not a
 *  bespoke bundling step invented here — a gate that builds the app
 *  differently from the way the app is actually shipped proves nothing about
 *  the shipped artifact. */
export async function buildViteApp(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const build = spawn('npm', ['run', 'build'], { cwd: VITE_APP_DIR, stdio: 'pipe' });
    let output = '';
    build.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    build.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    build.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`examples/vite \`npm run build\` exited with code ${code}:\n${output}`));
      }
    });
  });
}

/** Serves the already-built `dist/` on `port`. `--strictPort` so a port
 *  collision fails loudly instead of silently serving a DIFFERENT app on a
 *  fallback port. */
export async function previewViteApp(port: number): Promise<RunningServer> {
  const proc = spawn(VITE_BIN, ['preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: VITE_APP_DIR,
    stdio: 'pipe',
  });
  const baseURL = `http://127.0.0.1:${port}`;
  await waitForReady(baseURL, 60_000);
  return { baseURL, stop: () => stopProcess(proc) };
}

/** Concatenated text of every CSS asset the production build emitted. Used to
 *  assert the REAL Tailwind v4 compiler actually ran over this app's sources,
 *  rather than inferring it from a rendered colour that a hand-written
 *  stylesheet could equally have produced. */
export function readBuiltCss(): string {
  const assetsDir = path.join(DIST_DIR, 'assets');
  return readdirSync(assetsDir)
    .filter((name) => name.endsWith('.css'))
    .map((name) => readFileSync(path.join(assetsDir, name), 'utf8'))
    .join('\n');
}
