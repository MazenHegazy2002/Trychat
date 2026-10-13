// Learn more: https://docs.expo.dev/guides/customizing-metro
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-file-system has no web implementation: on web (and the desktop app) the app's own files use
// an IndexedDB-backed stand-in with the same API.
const WEB_SHIMS = {
  'expo-file-system': path.resolve(__dirname, 'src/shims/expo-file-system.web.ts'),
};

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_SHIMS[moduleName]) return { type: 'sourceFile', filePath: WEB_SHIMS[moduleName] };
  return upstream ? upstream(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
