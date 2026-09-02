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
  readonly if?: string;
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

describe('android-emulator-runner jobs can actually boot an emulator', () => {
  // An Android emulator cannot boot from an x86_64 image on an Apple Silicon
  // runner: HAXM is Intel-only and discontinued, and `macos-latest` stopped
  // being Intel. That is exactly how the frame-drop job failed on the first
  // run after this file started parsing at all — "Timeout waiting for emulator
  // to boot" / "could not connect to TCP port 5554", after never having
  // executed once. The two pairings that work are ubuntu + KVM (the documented
  // path, and an order of magnitude cheaper) or macos + arm64-v8a.
  it.each(workflowFiles)('%s: every emulator job pairs its runner with a bootable arch', (file) => {
    const workflow = readWorkflow(file);
    for (const [jobName, job] of jobsOf(workflow)) {
      const steps = stepsOf(job);
      const emulator = steps.find((step) => usesAction(step, 'reactivecircus/android-emulator-runner'));
      if (!emulator) {
        continue;
      }
      const runsOn = String((job as unknown as Record<string, unknown>)['runs-on'] ?? '');
      const arch = String((emulator.with ?? {}).arch ?? '');

      if (runsOn.startsWith('ubuntu')) {
        const enablesKvm = steps.some((step) => /kvm/i.test(step.run ?? ''));
        expect(
          enablesKvm,
          `${file}: job "${jobName}" runs the emulator on ${runsOn} without enabling KVM. The ` +
            `runner exposes /dev/kvm but not to the user the emulator runs as, so it times out ` +
            `waiting to boot.`,
        ).toBe(true);
        continue;
      }
      expect(
        arch,
        `${file}: job "${jobName}" runs the emulator on ${runsOn} with arch "${arch}". macos ` +
          `runners are Apple Silicon and cannot run an x86_64 Android image — use ubuntu + KVM, ` +
          `or arm64-v8a.`,
      ).toBe('arm64-v8a');
    }
  });
});

describe('emulator scripts do not rely on shell line continuations', () => {
  // `android-emulator-runner` does not run its `script:` through a shell that
  // joins `\` continuations, so a wrapped command arrives with the backslash
  // as a literal argument — Gradle reported `Task '\' not found in root
  // project`. The emulator had booted correctly by then; this was the next
  // failure hiding behind the boot failure.
  it.each(workflowFiles)('%s: no backslash continuation inside an emulator script', (file) => {
    const workflow = readWorkflow(file);
    for (const [jobName, job] of jobsOf(workflow)) {
      for (const step of stepsOf(job)) {
        if (!usesAction(step, 'reactivecircus/android-emulator-runner')) {
          continue;
        }
        const script = String((step.with ?? {}).script ?? '');
        expect(
          /\\\s*\n/.test(script),
          `${file}: job "${jobName}" wraps an emulator script line with a backslash. The action ` +
            `does not join continuations, so the backslash becomes a literal argument. Put the ` +
            `command on one line.`,
        ).toBe(false);
      }
    }
  });
});

// 20 of the 22 `bare-rn` matrix rows failed to install, all with one ERESOLVE:
//
//   While resolving: react-native@0.86.3
//   Found: @react-native/jest-preset@0.87.1
//
// The matrix swaps `react-native` to the row's version and re-pins four of the
// example's `@react-native/*` packages. `@react-native/jest-preset` and
// `@react-native/new-app-screen` were in neither list. Both peer-depend on
// react-native EXACTLY, so at the example's pinned 0.87.1 they contradict every
// older row before a line is compiled.
//
// THE SUBTLETY THAT MAKES THIS GATE NON-TRIVIAL, found by trying to plant the
// defect and watching the first version of this test stay green: the workflow
// DOES delete `@react-native/jest-preset` — inside a step guarded by
// `if: matrix.trim-example == 'true'`, which is false for exactly the rows that
// failed. A gate that greps the file for the delete therefore passes while the
// bug is live. Only a step that runs on EVERY row can be relied on, so this
// reads the parsed workflow and ignores any step carrying an `if:`.
//
// Deliberately scoped to `@react-native/*`: those are the packages React Native
// publishes in lockstep and pins exactly. An ordinary dependency with a normal
// semver range is not this problem.
//
// KNOWN LIMIT, stated because it already bit once. This gate asserts each
// package is HANDLED (re-pinned or deleted), not that the handling WORKS. The
// first attempt at the fix re-pinned `@react-native/new-app-screen` to the row
// instead of deleting it; this gate went green and CI stayed red, because that
// package peer-depends on react-native exactly and npm still resolved the
// example's version:
//   Found: @react-native/new-app-screen@0.87.1
//   Conflicting peer dependency: react-native@0.86.3
// Whether a given pin actually resolves is a property of the registry, not of
// these two files, so it cannot be decided here — only a real install can.
// Treat a green result as "nothing was forgotten", never as "the matrix builds".
describe('the RN matrix leaves no @react-native/* package at the example version', () => {
  const EXAMPLE = 'examples/bare-rn/package.json';
  const manifest = JSON.parse(
    readFileSync(path.join(REPO_ROOT, EXAMPLE), 'utf8')
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const scoped = Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  })
    .filter((name) => name.startsWith('@react-native/'))
    .sort();

  const workflow = readWorkflow('native-matrix.yml');

  // Only the jobs that actually re-pin react-native per row; the Expo jobs and
  // `pack-library` never touch the example's manifest.
  const pinningJobs = jobsOf(workflow).filter(([, job]) =>
    stepsOf(job).some((step) =>
      (step.run ?? '').includes('npm pkg set "dependencies.react-native=')
    )
  );

  it('there are jobs that re-pin react-native per row', () => {
    expect(pinningJobs.length).toBeGreaterThan(0);
  });

  it(`${EXAMPLE} declares some @react-native/* packages to begin with`, () => {
    // Without this the loops below pass vacuously if the example ever stops
    // declaring them, and the gate quietly stops meaning anything.
    expect(scoped.length).toBeGreaterThan(0);
  });

  for (const [jobId, job] of pinningJobs) {
    // A step with an `if:` runs on SOME rows. Only unconditional steps say
    // anything about the row that is currently failing.
    const unconditional = stepsOf(job)
      .filter((step) => step.if === undefined)
      .map((step) => step.run ?? '')
      .join('\n');

    for (const name of scoped) {
      it(`${jobId}: ${name} is re-pinned or deleted on every row`, () => {
        const pinned =
          unconditional.includes(`npm pkg set "dependencies.${name}=`) ||
          unconditional.includes(`npm pkg set "devDependencies.${name}=`);
        const deleted =
          unconditional.includes(`npm pkg delete dependencies.${name}`) ||
          unconditional.includes(`npm pkg delete devDependencies.${name}`);
        expect(
          pinned || deleted,
          `${name} is declared in ${EXAMPLE}, but ${jobId} neither re-pins nor ` +
            `deletes it in a step that runs on every row, so rows below the ` +
            `example's own version fail to install with ERESOLVE`
        ).toBe(true);
      });
    }
  }
});

// Android coverage of the supported React Native range is now spread across
// three jobs on purpose:
//
//   floor-rn-077-android        builds the committed `examples/rn-077`
//   genuine-app-android-matrix  scaffolds a real app per version, 0.78-0.86
//   bare-rn-android-matrix      builds `examples/bare-rn`, which IS a 0.87 app
//
// That split is what replaced six rounds of trying to mutate one 0.87 app into
// every older version. The risk it introduces is a version silently falling
// through the gap between three jobs — nothing would go red, the matrix would
// just quietly stop covering a minor the peer range still promises.
//
// So rather than maintain a list here that could itself drift, this asserts the
// SHAPE: exactly one row per minor, and no missing minor between the lowest and
// the highest covered. Adding 0.88 or dropping 0.81 both have to be deliberate.
describe('the Android jobs cover every RN minor in the supported range', () => {
  const workflow = readWorkflow('native-matrix.yml');

  function rowsOf(jobId: string, field: string): string[] {
    const job = (workflow.jobs ?? {})[jobId] as
      | { strategy?: { matrix?: { include?: Array<Record<string, string>> } } }
      | undefined;
    // `filter(Boolean)` does not narrow the type under
    // `noUncheckedIndexedAccess`, and an absent field would otherwise reach
    // `minorOf` as undefined and silently become NaN — a gap that reads as
    // "covered".
    return (job?.strategy?.matrix?.include ?? [])
      .map((row) => row[field])
      .filter((v): v is string => typeof v === 'string');
  }

  const exampleVersion = (
    JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'examples/rn-077/package.json'), 'utf8')
    ) as { dependencies: Record<string, string> }
  ).dependencies['react-native'];

  const covered = [
    ...rowsOf('bare-rn-android-matrix', 'react-native-version'),
    ...rowsOf('genuine-app-android-matrix', 'rn'),
    ...(exampleVersion === undefined ? [] : [exampleVersion]),
  ];

  const minorOf = (v: string): number => Number(v.split('.')[1] ?? NaN);
  const minors = covered.map(minorOf).sort((a, b) => a - b);

  it('covers a contiguous run of minors, with no version covered twice', () => {
    expect(covered.length).toBeGreaterThan(1);
    expect(new Set(minors).size, `a minor is covered by two jobs: ${covered.join(', ')}`).toBe(
      minors.length
    );
    // Read the endpoints once and narrow them: the loop bounds are indexed
    // accesses, so under `noUncheckedIndexedAccess` they are possibly
    // undefined, and `undefined <= undefined` would quietly skip the loop —
    // a gate that passes because it never ran.
    const lowest = minors[0];
    const highest = minors[minors.length - 1];
    expect(lowest, 'no minors were parsed out of the matrix').toBeTypeOf('number');
    expect(highest, 'no minors were parsed out of the matrix').toBeTypeOf('number');
    const missing: number[] = [];
    for (let m = lowest as number; m <= (highest as number); m += 1) {
      if (!minors.includes(m)) missing.push(m);
    }
    expect(
      missing,
      `no Android job builds RN 0.${missing.join(', 0.')}, but the peer range still promises it`
    ).toEqual([]);
  });

  it('starts at the minor the peer range declares as the floor', () => {
    // If `package.json` ever raises or lowers the floor, the matrix has to move
    // with it — a range nothing builds is the thing this whole file exists to
    // stop being possible.
    const declared = (
      JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
        peerDependencies: Record<string, string>;
      }
    ).peerDependencies['react-native'];
    const floorMinor = Number(/(\d+)\.(\d+)\./.exec(declared ?? '')?.[2] ?? NaN);
    expect(minors[0], `peer range says ${declared} but the lowest Android row is 0.${minors[0]}`).toBe(
      floorMinor
    );
  });
});

// The same contiguity property for iOS, which is covered by a different pair of
// jobs and at two different strengths: `genuine-app-ios-matrix` builds fully
// from 0.82 up and stops at CocoaPods autolinking below it, because React
// Native pins an `fmt` release current Clang rejects on 0.77-0.81.
//
// The weaker rows still have to EXIST. A version with no row at all reads as
// supported-and-checked, which is a worse lie than a row that states its limit —
// so this asserts coverage, and the row's own `full-build` flag carries how far
// that coverage goes.
describe('the iOS jobs cover every RN minor in the supported range', () => {
  const workflow = readWorkflow('native-matrix.yml');

  function rowsOf(jobId: string, field: string): string[] {
    const job = (workflow.jobs ?? {})[jobId] as
      | { strategy?: { matrix?: { include?: Array<Record<string, string>> } } }
      | undefined;
    // `filter(Boolean)` does not narrow the type under
    // `noUncheckedIndexedAccess`, and an absent field would otherwise reach
    // `minorOf` as undefined and silently become NaN — a gap that reads as
    // "covered".
    return (job?.strategy?.matrix?.include ?? [])
      .map((row) => row[field])
      .filter((v): v is string => typeof v === 'string');
  }

  const covered = [
    ...rowsOf('bare-rn-ios-matrix', 'react-native-version'),
    ...rowsOf('genuine-app-ios-matrix', 'rn'),
  ];
  const minors = covered.map((v) => Number(v.split('.')[1] ?? NaN)).sort((a, b) => a - b);

  it('covers a contiguous run of minors, none of them twice', () => {
    expect(covered.length).toBeGreaterThan(1);
    expect(new Set(minors).size, `a minor is covered twice: ${covered.join(', ')}`).toBe(
      minors.length
    );
    // Read the endpoints once and narrow them: the loop bounds are indexed
    // accesses, so under `noUncheckedIndexedAccess` they are possibly
    // undefined, and `undefined <= undefined` would quietly skip the loop —
    // a gate that passes because it never ran.
    const lowest = minors[0];
    const highest = minors[minors.length - 1];
    expect(lowest, 'no minors were parsed out of the matrix').toBeTypeOf('number');
    expect(highest, 'no minors were parsed out of the matrix').toBeTypeOf('number');
    const missing: number[] = [];
    for (let m = lowest as number; m <= (highest as number); m += 1) {
      if (!minors.includes(m)) missing.push(m);
    }
    expect(
      missing,
      `no iOS job covers RN 0.${missing.join(', 0.')}, but the peer range still promises it`
    ).toEqual([]);
  });

  it('starts at the minor the peer range declares as the floor', () => {
    const declared = (
      JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
        peerDependencies: Record<string, string>;
      }
    ).peerDependencies['react-native'];
    const floorMinor = Number(/(\d+)\.(\d+)\./.exec(declared ?? '')?.[2] ?? NaN);
    expect(minors[0], `peer range says ${declared} but the lowest iOS row is 0.${minors[0]}`).toBe(
      floorMinor
    );
  });
});
