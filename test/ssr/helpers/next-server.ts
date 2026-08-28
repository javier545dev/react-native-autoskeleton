// test/ssr/helpers/next-server.ts
//
// tasks.md 8.3: process helpers for the two-phase SSR test setup. Phase 1
// spawns a temporary `next dev` server long enough for `cli/capture.ts` to
// capture the `dashboard-capture` route against REAL Next.js rendering, then
// kills it. Phase 2 (`next build && next start`) then produces the actual
// production server the SSR assertions run against — a fresh build after
// the manifest/CSS bundle are written is required because a `force-dynamic`
// route's IMPORTED JSON constant is still frozen into the compiled server
// bundle at BUILD time (dynamic rendering controls WHEN the HTML streams,
// not whether Next re-reads an imported file per request). Doing capture
// under `next dev` and verification under `next build && next start` avoids
// entirely the dev-mode file-watcher race a live-regenerate-under-dev
// approach would risk.

import { type ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';

const NEXT_APP_DIR = path.resolve(__dirname, '../../../examples/next');
const NEXT_BIN = path.join(NEXT_APP_DIR, 'node_modules/.bin/next');

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
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Next.js server at ${baseURL} did not become ready within ${timeoutMs}ms: ${String(lastError)}`);
}

function spawnNext(args: readonly string[], port: number): ChildProcess {
  return spawn(NEXT_BIN, [...args, '-p', String(port)], {
    cwd: NEXT_APP_DIR,
    stdio: 'pipe',
    env: { ...process.env, NODE_ENV: args[0] === 'dev' ? 'development' : 'production' },
  });
}

function stopProcess(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.killed) {
      resolve();
      return;
    }
    proc.once('exit', () => resolve());
    proc.kill('SIGTERM');
    // `next dev`/`next start` sometimes ignores a bare SIGTERM to its own
    // process while a child worker is still shutting down; force it after a
    // grace period so a hung server never blocks the test run indefinitely.
    setTimeout(() => {
      if (proc.exitCode === null && !proc.killed) {
        proc.kill('SIGKILL');
      }
    }, 5000).unref();
  });
}

/** Starts `next dev` on `port` and resolves once it responds. Used ONLY for
 *  the capture phase — dev-mode fidelity is irrelevant to a DOM-geometry
 *  capture, and dev mode compiles a single on-demand route faster than a
 *  full production build for a throwaway server. */
export async function startNextDev(port: number): Promise<RunningServer> {
  const proc = spawnNext(['dev'], port);
  const baseURL = `http://127.0.0.1:${port}`;
  await waitForReady(baseURL, 60_000);
  return { baseURL, stop: () => stopProcess(proc) };
}

/** Runs `next build`, then starts `next start` on `port`. This is the
 *  production server the actual SSR assertions run against — must run
 *  AFTER the manifest/CSS bundle files are written to disk (see this file's
 *  header comment for why). */
export async function buildAndStartNextProd(port: number): Promise<RunningServer> {
  await new Promise<void>((resolve, reject) => {
    const build = spawn(NEXT_BIN, ['build'], { cwd: NEXT_APP_DIR, stdio: 'pipe' });
    let stderr = '';
    build.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    build.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`next build exited with code ${code}:\n${stderr}`));
      }
    });
  });

  const proc = spawnNext(['start'], port);
  const baseURL = `http://127.0.0.1:${port}`;
  await waitForReady(baseURL, 60_000);
  return { baseURL, stop: () => stopProcess(proc) };
}
