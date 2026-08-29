// cli/peer-dependency.ts
//
// RISK-5 packaging fix (orchestrator-found defect, see
// `test/packaging/entries.test.ts`'s "no runtime `dependencies` footprint"
// guard): `@playwright/test` moved from an eager `dependencies` entry
// (forced on every consumer) to an optional `peerDependency` that only a
// CLI user installs. `cli/capture.ts` therefore loads it LAZILY, at the
// point of use, instead of via a static top-level `import` — a static
// import would `require("@playwright/test")` unconditionally at module
// load, throwing a raw `MODULE_NOT_FOUND` for a consumer who only imports
// `runCapture`'s TYPES or never calls it. This mirrors ADR-15's discipline
// for the missing-native-module case: a named, actionable error instead of
// a silent or cryptic failure (`plan.md` ADR-15, RISK-10).
//
// `isModuleNotFoundFor` distinguishes "this exact module specifier isn't
// installed" from any other failure — including a `MODULE_NOT_FOUND` thrown
// by one of THAT module's own missing transitive dependencies, which must
// propagate unchanged rather than be mislabeled as "install this peer".

export function isModuleNotFoundFor(error: unknown, specifier: string): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== 'MODULE_NOT_FOUND' && code !== 'ERR_MODULE_NOT_FOUND') {
    return false;
  }
  return error.message.includes(`'${specifier}'`) || error.message.includes(`"${specifier}"`);
}
