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

// 3. With a flat (hoisted) store there is a single copy of each dependency;
//    disabling the hierarchical lookup keeps resolution deterministic.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
