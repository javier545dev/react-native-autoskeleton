const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  // Watchman cannot crawl this directory in the current sandboxed
  // environment ("Operation not permitted"), crashing Metro on startup;
  // node crawler fallback (already what Jest silently uses here) is fine
  // for local/CI use — no behavior change for consumers with a working
  // watchman.
  resolver: {
    useWatchman: false,
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
