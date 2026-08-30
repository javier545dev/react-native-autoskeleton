// test/packaging/workflows.test.ts
//
// WHY THIS FILE EXISTS. Every one of the five workflows in
// `.github/workflows/` was red, and nobody noticed, because the entire suite
// has only ever been run on one laptop. Four of those five failures are
// STATIC properties of the workflow files — a YAML parse error, an artifact
// that is downloaded but never produced, an upload that silently matches zero
// files, an example install that reads a lockfile pin it cannot satisfy. All
// four are checkable without a runner, so all four are checked here.
//
// A CI configuration that only CI can validate is a configuration nobody
// validates until it is already broken on main. These gates run in the normal
// `npm test` suite, on the same laptop, in milliseconds.
//
// What is DELIBERATELY NOT gated here: anything that needs a real runner
// (whether `gradlew assembleDebug` actually links, whether an emulator boots).
// This file gates the file, not the run.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const REPO_ROOT = path.resolve(__dirname, '../..');
const WORKFLOW_DIR = path.join(REPO_ROOT, '.github/workflows');

const workflowFiles = readdirSync(WORKFLOW_DIR)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

interface Step {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Record<string, unknown>;
  readonly 'working-directory'?: string;
}

interface Job {
  readonly needs?: string | readonly string[];
  readonly steps?: readonly Step[];
}

interface Workflow {
  readonly jobs?: Record<string, Job>;
}

function readWorkflow(file: string): Workflow {
  return parse(readFileSync(path.join(WORKFLOW_DIR, file), 'utf8')) as Workflow;
}

function jobsOf(workflow: Workflow): ReadonlyArray<readonly [string, Job]> {
  return Object.entries(workflow.jobs ?? {});
}

function stepsOf(job: Job): readonly Step[] {
  return job.steps ?? [];
}

function usesAction(step: Step, action: string): boolean {
  return typeof step.uses === 'string' && step.uses.split('@')[0] === action;
}

/** `needs:` closure, so a consumer three jobs downstream still counts as
 *  ordered after its producer. */
function transitiveNeeds(workflow: Workflow, jobId: string): ReadonlySet<string> {
  const out = new Set<string>();
  const walk = (id: string): void => {
    const job = workflow.jobs?.[id];
    if (!job?.needs) return;
    const direct = typeof job.needs === 'string' ? [job.needs] : job.needs;
    for (const dep of direct) {
      if (out.has(dep)) continue;
      out.add(dep);
      walk(dep);
    }
  };
  walk(jobId);
  return out;
}

/** True when any segment of a glob/path is hidden (starts with a dot).
 *  `@actions/glob` skips such a segment entirely — including the search root
 *  it derives from the literal prefix of the pattern — unless
 *  `excludeHiddenFiles` is turned off, which `actions/upload-artifact`
 *  exposes as `include-hidden-files`. */
function hasHiddenSegment(globPath: string): boolean {
  return globPath
    .split('\n')
    .flatMap((line) => line.split('/'))
    .some((segment) => segment.startsWith('.') && segment !== '.' && segment !== '..');
}

describe('every workflow file is valid YAML', () => {
  // The single highest-value gate in this file. `benchmarks.yml` shipped with
  // an unquoted `run: echo "TODO(...): ..."` — a plain scalar containing
  // `": "` — so GitHub rejected the whole file with "This run likely failed
  // because of a workflow file issue" and the frame-drop / memory jobs inside
  // it never executed once. A workflow that does not parse does not run, and
  // a workflow that does not run cannot report that it did not run.
  it.each(workflowFiles)('%s parses', (file) => {
    expect(() => readWorkflow(file)).not.toThrow();
  });

  it.each(workflowFiles)('%s declares at least one job with steps', (file) => {
    const workflow = readWorkflow(file);
    const jobs = jobsOf(workflow);
    expect(jobs.length).toBeGreaterThan(0);
    for (const [jobId, job] of jobs) {
      expect(stepsOf(job).length, `${file} job ${jobId} has no steps`).toBeGreaterThan(0);
    }
  });
});

describe('artifact wiring is closed inside each workflow', () => {
  // GitHub Actions artifacts are scoped to a single workflow RUN. A workflow
  // can never download an artifact another workflow uploaded, so every
  // `download-artifact` needs a producer in its own file and behind its own
  // `needs:` edge.
  it.each(workflowFiles)('%s: every downloaded artifact has a producer job it depends on', (file) => {
    const workflow = readWorkflow(file);
    const producers = new Map<string, string[]>();
    for (const [jobId, job] of jobsOf(workflow)) {
      for (const step of stepsOf(job)) {
        if (!usesAction(step, 'actions/upload-artifact')) continue;
        const name = String(step.with?.name ?? 'artifact');
        producers.set(name, [...(producers.get(name) ?? []), jobId]);
      }
    }

    for (const [jobId, job] of jobsOf(workflow)) {
      for (const step of stepsOf(job)) {
        if (!usesAction(step, 'actions/download-artifact')) continue;
        const name = String(step.with?.name ?? 'artifact');
        const producerJobs = producers.get(name);
        expect(
          producerJobs,
          `${file}: job "${jobId}" downloads artifact "${name}", which no job in THIS workflow uploads. ` +
            'Artifacts are scoped to one workflow run — a producer in another file is invisible here.',
        ).toBeDefined();
        const needs = transitiveNeeds(workflow, jobId);
        expect(
          producerJobs!.some((producer) => needs.has(producer)),
          `${file}: job "${jobId}" downloads "${name}" but does not (transitively) need ${JSON.stringify(producerJobs)}.`,
        ).toBe(true);
      }
    }
  });
});

describe('an upload that produces nothing can never pass silently', () => {
  // `actions/upload-artifact@v4` defaults to `if-no-files-found: warn`. The
  // `pack-library` job packed a real tarball, matched zero files, warned, and
  // EXITED GREEN — then four downstream jobs failed with "Artifact not found".
  // The green producer is the actual defect: the failure surfaced three jobs
  // and one `needs:` edge away from its cause.
  it.each(workflowFiles)('%s: every artifact another job consumes is uploaded with if-no-files-found: error', (file) => {
    const workflow = readWorkflow(file);
    const consumed = new Set<string>();
    for (const [, job] of jobsOf(workflow)) {
      for (const step of stepsOf(job)) {
        if (usesAction(step, 'actions/download-artifact')) {
          consumed.add(String(step.with?.name ?? 'artifact'));
        }
      }
    }

    for (const [jobId, job] of jobsOf(workflow)) {
      for (const step of stepsOf(job)) {
        if (!usesAction(step, 'actions/upload-artifact')) continue;
        const name = String(step.with?.name ?? 'artifact');
        if (!consumed.has(name)) continue; // report-only artifacts may legitimately be empty
        expect(
          step.with?.['if-no-files-found'],
          `${file}: job "${jobId}" uploads "${name}", which another job downloads, without ` +
            '`if-no-files-found: error`. The default (`warn`) lets an empty upload pass as success.',
        ).toBe('error');
      }
    }
  });

  // The cause of the empty upload, gated directly. `@actions/glob` skips any
  // path segment matching /^\./ when `excludeHiddenFiles` is on, and
  // upload-artifact turns it on unless `include-hidden-files: true`. The
  // skipped segment includes the search ROOT derived from the pattern's
  // literal prefix, so `.tarball/*.tgz` never descends into `.tarball` at all
  // and matches zero files — with the tarball sitting right there.
  it.each(workflowFiles)('%s: an upload path with a hidden segment sets include-hidden-files', (file) => {
    const workflow = readWorkflow(file);
    for (const [jobId, job] of jobsOf(workflow)) {
      for (const step of stepsOf(job)) {
        if (!usesAction(step, 'actions/upload-artifact')) continue;
        const uploadPath = String(step.with?.path ?? '');
        if (!hasHiddenSegment(uploadPath)) continue;
        expect(
          step.with?.['include-hidden-files'],
          `${file}: job "${jobId}" uploads "${uploadPath}", which contains a dot-prefixed segment. ` +
            'upload-artifact@v4 excludes hidden files by default and would match ZERO files.',
        ).toBe(true);
      }
    }
  });
});

describe('example apps are installed in a way a committed integrity pin cannot break', () => {
  // `examples/*/package-lock.json` pins `integrity` for
  // `autoskeleton@file:../../.tarball/autoskeleton-0.1.0.tgz` — a hash of a
  // LOCAL BUILD OUTPUT. CI packs its own tarball, so that pin is only ever
  // true by coincidence, and it was already false for `examples/expo`
  // (EINTEGRITY, `docs.yml`). `scripts/unpin-local-tarball.mjs` drops the
  // stale pin so npm re-derives it from the bytes actually on disk; every
  // example install must run behind it.
  const EXAMPLE_INSTALL = /npm (install|ci)\b/;
  const UNPIN = 'unpin-local-tarball.mjs';

  it.each(workflowFiles)('%s: every `npm install` inside examples/ runs after the unpin step', (file) => {
    const workflow = readWorkflow(file);
    for (const [jobId, job] of jobsOf(workflow)) {
      const steps = stepsOf(job);
      steps.forEach((step, index) => {
        const workingDirectory = step['working-directory'] ?? '';
        const run = step.run ?? '';
        const targetsExample =
          workingDirectory.startsWith('examples/') || /(cd|--prefix)\s+examples\//.test(run);
        if (!targetsExample || !EXAMPLE_INSTALL.test(run)) return;

        expect(
          steps.slice(0, index).some((earlier) => (earlier.run ?? '').includes(UNPIN)),
          `${file}: job "${jobId}" step ${index} installs in "${workingDirectory || run}" without an earlier ` +
            `\`${UNPIN}\` step. The committed lockfile pins the integrity of a locally built tarball; ` +
            'CI builds its own bytes and the install fails with EINTEGRITY.',
        ).toBe(true);

        // `npm ci` requires package.json and the lockfile to agree exactly.
        // Unpinning deliberately removes an entry, so `npm ci` would reject
        // the tree it is supposed to install.
        expect(
          /npm ci\b/.test(run),
          `${file}: job "${jobId}" uses \`npm ci\` inside an example after unpinning. Use \`npm install\`: ` +
            'the local-tarball edge is intentionally absent from the lockfile and `npm ci` refuses to resolve it.',
        ).toBe(false);
      });
    }
  });
});
