// Monorepo-aware Metro config (Expo's recommended pnpm setup).
// Lets Metro watch and transpile the workspace `@mypro/shared` TS source and
// resolve hoisted dependencies from the workspace root.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// 1. Watch the whole workspace so changes in shared/ trigger a reload.
config.watchFolders = [workspaceRoot];

// 2. Resolve modules from the app first, then the hoisted workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Keep the hierarchical lookup ON.
//
//    CI installs a flat tree, where it costs nothing. Locally the tree may be
//    pnpm's isolated layout instead, where a package's transitive deps live
//    beside it under `.pnpm/<pkg>/node_modules`; Metro only finds those by
//    walking up from the resolved realpath, so disabling the walk broke the
//    bundle with "Unable to resolve @babel/runtime/helpers/…".
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
