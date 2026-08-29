// examples/vite/scripts/capture-skeletons.ts
//
// A REAL consumer of `autoskeleton/cli`'s documented Programmatic API
// (`docs/ssr-capture-cli.md` § "Programmatic API"), typechecked from an
// example app that installs the package exactly the way a user does — from the
// packed tarball (`file:../../.tarball/autoskeleton-0.1.0.tgz`), never a
// workspace symlink into this repo's sources.
//
// WHY THIS FIXTURE EXISTS (adversarial review, batch 3). `exports['./cli'].types`
// used to point at `./cli/index.ts` — RAW TypeScript SOURCE. TypeScript then
// pulled 19 of OUR `.ts` files (`cli/**` plus their `src/core/**` and
// `src/web/**` imports) into the CONSUMER's program and compiled them under the
// CONSUMER's compiler options. Measured against this exact config on the
// pre-fix tarball: **26 `error TS…` lines in files the consumer never wrote**
// (`Cannot find module 'node:fs/promises'`, `Cannot find name '__dirname'`,
// `Cannot find namespace 'NodeJS'`, and four `TS1294 … 'erasableSyntaxOnly'`
// hits inside `src/core/wire.ts`). After the fix: 0.
//
// `skipLibCheck` — set to `true` right here in `tsconfig.app.json`, as in most
// real apps — does NOT rescue this. It skips DECLARATION (`.d.ts`) files, and
// raw `.ts` is not one, so it is checked no matter what the consumer sets.
//
// WHY THE VITE EXAMPLE and not the Next one: the errors above are option-
// dependent, and `create-vite`'s default React+TS option set (`types:
// ["vite/client"]` so no Node types, plus `erasableSyntaxOnly`) is the one that
// actually surfaces them. `examples/next`'s Node-typed config happened to
// compile our sources clean — which is luck, not safety, and exactly why the
// pointer, not the consumer's luck, is what got fixed.
//
// This is a typecheck fixture, not a build step: `npm run
// typecheck:cli-consumer`. It lives in `scripts/`, outside `src/`, so Vite
// never bundles a Node-only module into the browser app.

import { runCapture } from 'autoskeleton/cli';
import type { CaptureRegistry, RunCaptureOptions, RunCaptureResult } from 'autoskeleton/cli';

const registry: CaptureRegistry = { dashboard: '/dashboard-capture' };

const options: RunCaptureOptions = {
  baseURL: 'http://localhost:5173',
  registry,
  outDir: './generated/autoskeleton-ssr',
};

export async function captureSkeletons(): Promise<RunCaptureResult> {
  const result = await runCapture(options);
  console.log(`Captured: ${result.report.capturedKeys.join(', ')}`);
  if (result.report.failedKeys.length > 0) {
    console.error(`Failed: ${result.report.failedKeys.join(', ')}`);
  }
  return result;
}
