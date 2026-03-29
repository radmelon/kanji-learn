// Learn more: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

// Watch all packages in the monorepo
config.watchFolders = [monorepoRoot]

// Resolve modules from monorepo root first, then project root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
]

// pnpm uses symlinks into a content-addressable store; Metro must follow them
config.resolver.unstable_enableSymlinks = true

module.exports = config
