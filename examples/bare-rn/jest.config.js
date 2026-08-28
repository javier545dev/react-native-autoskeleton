module.exports = {
  preset: '@react-native/jest-preset',
  // Jest's default resolver applies no "react-native" package.json `exports`
  // condition, so a bare `require('autoskeleton')` here would otherwise fall
  // through to the `default` condition (`lib/module/index.js`, which
  // re-exports the WEB build per ADR-3) instead of the native one — a real
  // gap discovered once `App.tsx` (this example) started importing the
  // package. Metro is unaffected (it always honors the `react-native`
  // condition), so this only matters for this Jest harness.
  testEnvironmentOptions: {
    customExportConditions: ['react-native'],
  },
};
