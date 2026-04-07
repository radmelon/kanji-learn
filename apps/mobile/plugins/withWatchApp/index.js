/**
 * withWatchApp — Expo config plugin
 *
 * Embeds the KanjiLearn WatchOS companion app into the EAS iOS build so that
 * both apps are distributed from the same channel (TestFlight / App Store).
 *
 * This is required because WCSession.isWatchAppInstalled (and therefore
 * updateApplicationContext) only works when both apps share the same
 * distribution channel. A Xcode dev-installed Watch app is invisible to a
 * TestFlight iPhone app.
 *
 * What this plugin does on `expo prebuild`:
 *   1. Copies Watch source files from apps/watch/KanjiLearnWatch/ → ios/KanjiLearnWatch/
 *   2. Adds a watchOS native target to the generated Xcode project (pbxproj)
 *   3. Adds an "Embed Watch Apps" build phase to the iPhone target
 *   4. Adds the Watch app as a dependency of the iPhone target (builds first)
 */

const { withDangerousMod, withXcodeProject } = require('expo/config-plugins')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

// ─── Constants ─────────────────────────────────────────────────────────────────

const WATCH_TARGET        = 'KanjiLearnWatch'
const WATCH_BUNDLE_ID     = 'com.rdennis.kanjilearn2.watchkitapp'
const WATCHOS_DEPLOY      = '10.0'
const TEAM_ID             = 'JN43UP9MQL'
const SWIFT_VERSION       = '5.9'
// Must match the profile name used when creating it on developer.apple.com
const WATCH_PROFILE_NAME  = 'Kanji Learn Watch Distribution'

// pbxproj-style UUID: 24 uppercase hex characters
const uid = () => crypto.randomBytes(12).toString('hex').toUpperCase()

// ─── Step 1: Copy Watch sources into ios/KanjiLearnWatch/ ─────────────────────

function withWatchFiles(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const iosDir = config.modRequest.platformProjectRoot

      // EAS uploads the full pnpm workspace, so apps/watch/ is available.
      // ios/ is at apps/mobile/ios/ → ../../watch/KanjiLearnWatch is apps/watch/KanjiLearnWatch/
      const watchSrc = path.resolve(iosDir, '..', '..', 'watch', 'KanjiLearnWatch')
      const watchDst = path.join(iosDir, WATCH_TARGET)

      if (!fs.existsSync(watchSrc)) {
        // Fallback: if running outside the monorepo, log a clear error
        throw new Error(
          `[withWatchApp] Watch source not found at ${watchSrc}. ` +
          `Ensure apps/watch/KanjiLearnWatch/ exists and is committed.`
        )
      }

      copyDirSync(watchSrc, watchDst)
      console.log(`[withWatchApp] Copied Watch sources → ${watchDst}`)

      // ── Install Watch provisioning profile (EAS builds only) ──────────────
      // The WATCH_MOBILEPROVISION_B64 secret is set via `eas env:create`.
      // It contains the base64-encoded App Store distribution .mobileprovision
      // for com.rdennis.kanjilearn2.watchkitapp. Without it, Xcode can't sign
      // the Watch target during the EAS build (automatic signing is disabled).
      const profileB64 = process.env.WATCH_MOBILEPROVISION_B64
      if (profileB64) {
        const profileContent = Buffer.from(profileB64, 'base64')
        const profilesDir = path.join(
          os.homedir(), 'Library', 'MobileDevice', 'Provisioning Profiles'
        )
        fs.mkdirSync(profilesDir, { recursive: true })
        const profileDst = path.join(profilesDir, 'kanji-learn-watch.mobileprovision')
        fs.writeFileSync(profileDst, profileContent)
        console.log(`[withWatchApp] Installed Watch provisioning profile → ${profileDst}`)
      } else {
        console.log('[withWatchApp] WATCH_MOBILEPROVISION_B64 not set — Watch target will use automatic signing (local dev only)')
      }

      return config
    },
  ])
}

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dst, entry.name)
    if (entry.isDirectory()) copyDirSync(s, d)
    else fs.copyFileSync(s, d)
  }
}

// ─── Step 2: Inject Watch target into the Xcode project ───────────────────────

function withWatchXcodeTarget(config) {
  return withXcodeProject(config, (config) => {
    const project = config.modResults
    const objects  = project.hash.project.objects

    // ── Idempotency guard ──────────────────────────────────────────────────────
    const existingTargets = objects['PBXNativeTarget'] || {}
    if (Object.values(existingTargets).some(t => typeof t === 'object' && t.name === WATCH_TARGET)) {
      console.log('[withWatchApp] Watch target already present — skipping')
      return config
    }

    const iosDir   = config.modRequest.platformProjectRoot
    const watchDir = path.join(iosDir, WATCH_TARGET)
    if (!fs.existsSync(watchDir)) {
      console.warn('[withWatchApp] ios/KanjiLearnWatch/ not found — skipping Xcode target injection')
      return config
    }

    // ── Collect Swift source files ─────────────────────────────────────────────
    const swiftFiles = []
    const collectSwift = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name)
        if (entry.isDirectory()) collectSwift(p)
        else if (entry.name.endsWith('.swift')) swiftFiles.push(p)
      }
    }
    collectSwift(watchDir)

    // ── Generate all UUIDs up front ────────────────────────────────────────────
    const watchProductRefUuid     = uid()   // PBXFileReference for the .app bundle
    const watchGroupUuid          = uid()   // PBXGroup for Watch sources
    const watchTargetUuid         = uid()   // PBXNativeTarget
    const sourcesBuildPhaseUuid   = uid()   // PBXSourcesBuildPhase
    const frameworksBuildPhaseUuid = uid()  // PBXFrameworksBuildPhase (empty)
    const resourcesBuildPhaseUuid  = uid()  // PBXResourcesBuildPhase (empty)
    const debugConfigUuid         = uid()   // XCBuildConfiguration Debug
    const releaseConfigUuid       = uid()   // XCBuildConfiguration Release
    const configListUuid          = uid()   // XCConfigurationList for Watch target
    const embedPhaseUuid          = uid()   // PBXCopyFilesBuildPhase "Embed Watch Apps"
    const embedBuildFileUuid      = uid()   // PBXBuildFile for embedded Watch .app
    const containerItemUuid       = uid()   // PBXContainerItemProxy
    const targetDependencyUuid    = uid()   // PBXTargetDependency

    // ── Ensure pbxproj sections exist ─────────────────────────────────────────
    for (const section of [
      'PBXFileReference', 'PBXBuildFile', 'PBXGroup',
      'PBXSourcesBuildPhase', 'PBXFrameworksBuildPhase', 'PBXResourcesBuildPhase',
      'PBXCopyFilesBuildPhase', 'PBXNativeTarget',
      'XCBuildConfiguration', 'XCConfigurationList',
      'PBXContainerItemProxy', 'PBXTargetDependency',
    ]) { if (!objects[section]) objects[section] = {} }

    // ── Watch .app product file reference ─────────────────────────────────────
    objects['PBXFileReference'][watchProductRefUuid] = {
      isa: 'PBXFileReference',
      explicitFileType: 'wrapper.application',
      includeInIndex: 0,
      path: `${WATCH_TARGET}.app`,
      sourceTree: 'BUILT_PRODUCTS_DIR',
    }
    objects['PBXFileReference'][`${watchProductRefUuid}_comment`] = `${WATCH_TARGET}.app`

    // ── Per-file PBXFileReference + PBXBuildFile entries ──────────────────────
    const SUBDIRS = ['Models', 'Services', 'ViewModels', 'Views']
    const fileRefs = []  // { fileRefUuid, buildFileUuid, name, relPath, subdir }

    for (const filePath of swiftFiles) {
      const fileRefUuid   = uid()
      const buildFileUuid = uid()
      const name    = path.basename(filePath)
      const relPath = path.relative(iosDir, filePath).replace(/\\/g, '/')
      const subdir  = SUBDIRS.find(d => relPath.includes(`/${d}/`)) ?? null

      objects['PBXFileReference'][fileRefUuid] = {
        isa: 'PBXFileReference',
        lastKnownFileType: 'sourcecode.swift',
        name: `"${name}"`,
        path: `"${relPath}"`,
        sourceTree: '"<group>"',
      }
      objects['PBXFileReference'][`${fileRefUuid}_comment`] = name

      objects['PBXBuildFile'][buildFileUuid] = {
        isa: 'PBXBuildFile',
        fileRef: fileRefUuid,
      }
      objects['PBXBuildFile'][`${buildFileUuid}_comment`] = `${name} in Sources`

      fileRefs.push({ fileRefUuid, buildFileUuid, name, relPath, subdir })
    }

    // ── Embed build file (Watch .app → iPhone embed phase) ────────────────────
    objects['PBXBuildFile'][embedBuildFileUuid] = {
      isa: 'PBXBuildFile',
      fileRef: watchProductRefUuid,
      settings: { ATTRIBUTES: ['RemoveHeadersOnCopy'] },
    }
    objects['PBXBuildFile'][`${embedBuildFileUuid}_comment`] = `${WATCH_TARGET}.app in Embed Watch Apps`

    // ── PBXGroups: one per subdir, then the top-level Watch group ─────────────
    const subgroupUuids = {}
    for (const subdir of SUBDIRS) {
      const files = fileRefs.filter(f => f.subdir === subdir)
      if (files.length === 0) continue
      const subgroupUuid = uid()
      objects['PBXGroup'][subgroupUuid] = {
        isa: 'PBXGroup',
        children: files.map(f => ({ value: f.fileRefUuid, comment: f.name })),
        name: `"${subdir}"`,
        sourceTree: '"<group>"',
      }
      objects['PBXGroup'][`${subgroupUuid}_comment`] = subdir
      subgroupUuids[subdir] = subgroupUuid
    }

    const topFiles = fileRefs.filter(f => f.subdir === null)
    objects['PBXGroup'][watchGroupUuid] = {
      isa: 'PBXGroup',
      children: [
        ...topFiles.map(f => ({ value: f.fileRefUuid, comment: f.name })),
        ...Object.entries(subgroupUuids).map(([n, u]) => ({ value: u, comment: n })),
      ],
      name: `"${WATCH_TARGET}"`,
      path: `"${WATCH_TARGET}"`,
      sourceTree: '"<group>"',
    }
    objects['PBXGroup'][`${watchGroupUuid}_comment`] = WATCH_TARGET

    // ── Wire into project's mainGroup and Products group ──────────────────────
    const pbxProjSection = objects['PBXProject'] || {}
    const projectKey = Object.keys(pbxProjSection).find(
      k => !k.endsWith('_comment') && typeof pbxProjSection[k] === 'object'
    )

    if (projectKey) {
      const mainGroupUuid = pbxProjSection[projectKey].mainGroup
      if (mainGroupUuid && objects['PBXGroup'][mainGroupUuid]) {
        objects['PBXGroup'][mainGroupUuid].children.push(
          { value: watchGroupUuid, comment: WATCH_TARGET }
        )
      }
    }

    const productsGroupUuid = Object.keys(objects['PBXGroup']).find(
      k => !k.endsWith('_comment') &&
           typeof objects['PBXGroup'][k] === 'object' &&
           objects['PBXGroup'][k].name === 'Products'
    )
    if (productsGroupUuid) {
      objects['PBXGroup'][productsGroupUuid].children.push(
        { value: watchProductRefUuid, comment: `${WATCH_TARGET}.app` }
      )
    }

    // ── Build Phases for Watch target ─────────────────────────────────────────
    objects['PBXSourcesBuildPhase'][sourcesBuildPhaseUuid] = {
      isa: 'PBXSourcesBuildPhase',
      buildActionMask: 2147483647,
      files: fileRefs.map(f => ({ value: f.buildFileUuid, comment: `${f.name} in Sources` })),
      runOnlyForDeploymentPostprocessing: 0,
    }
    objects['PBXSourcesBuildPhase'][`${sourcesBuildPhaseUuid}_comment`] = 'Sources'

    objects['PBXFrameworksBuildPhase'][frameworksBuildPhaseUuid] = {
      isa: 'PBXFrameworksBuildPhase',
      buildActionMask: 2147483647,
      files: [],
      runOnlyForDeploymentPostprocessing: 0,
    }
    objects['PBXFrameworksBuildPhase'][`${frameworksBuildPhaseUuid}_comment`] = 'Frameworks'

    objects['PBXResourcesBuildPhase'][resourcesBuildPhaseUuid] = {
      isa: 'PBXResourcesBuildPhase',
      buildActionMask: 2147483647,
      files: [],
      runOnlyForDeploymentPostprocessing: 0,
    }
    objects['PBXResourcesBuildPhase'][`${resourcesBuildPhaseUuid}_comment`] = 'Resources'

    // ── Build Configurations for Watch target ─────────────────────────────────
    // Use manual signing when the profile secret is available (EAS builds),
    // automatic signing otherwise (local development with Xcode).
    const hasProfile = !!process.env.WATCH_MOBILEPROVISION_B64
    const codeSignStyle = hasProfile ? 'Manual' : 'Automatic'

    const commonSettings = {
      ALWAYS_SEARCH_USER_PATHS: 'NO',
      ASSETCATALOG_COMPILER_APPICON_NAME: 'AppIcon',
      CODE_SIGN_IDENTITY: hasProfile ? '"Apple Distribution"' : '"Apple Development"',
      CODE_SIGN_STYLE: codeSignStyle,
      CURRENT_PROJECT_VERSION: '1',
      DEVELOPMENT_TEAM: TEAM_ID,
      ENABLE_USER_SCRIPT_SANDBOXING: 'NO',
      INFOPLIST_FILE: `"${WATCH_TARGET}/Info.plist"`,
      MARKETING_VERSION: '1.0',
      PRODUCT_BUNDLE_IDENTIFIER: `"${WATCH_BUNDLE_ID}"`,
      PRODUCT_NAME: '"$(TARGET_NAME)"',
      PROVISIONING_PROFILE_SPECIFIER: hasProfile ? `"${WATCH_PROFILE_NAME}"` : '""',
      SDKROOT: 'watchos',
      SKIP_INSTALL: 'NO',
      SWIFT_VERSION: SWIFT_VERSION,
      TARGETED_DEVICE_FAMILY: '"4"',
      WATCHOS_DEPLOYMENT_TARGET: WATCHOS_DEPLOY,
    }

    objects['XCBuildConfiguration'][debugConfigUuid] = {
      isa: 'XCBuildConfiguration',
      buildSettings: {
        ...commonSettings,
        CODE_SIGN_ENTITLEMENTS: `"${WATCH_TARGET}/KanjiLearnWatch.entitlements"`,
        DEBUG_INFORMATION_FORMAT: 'dwarf',
        SWIFT_ACTIVE_COMPILATION_CONDITIONS: 'DEBUG',
        SWIFT_OPTIMIZATION_LEVEL: '"-Onone"',
      },
      name: 'Debug',
    }
    objects['XCBuildConfiguration'][`${debugConfigUuid}_comment`] = 'Debug'

    objects['XCBuildConfiguration'][releaseConfigUuid] = {
      isa: 'XCBuildConfiguration',
      buildSettings: {
        ...commonSettings,
        CODE_SIGN_ENTITLEMENTS: `"${WATCH_TARGET}/KanjiLearnWatchRelease.entitlements"`,
        DEBUG_INFORMATION_FORMAT: '"dwarf-with-dsym"',
        SWIFT_OPTIMIZATION_LEVEL: '"-O"',
        VALIDATE_PRODUCT: 'YES',
      },
      name: 'Release',
    }
    objects['XCBuildConfiguration'][`${releaseConfigUuid}_comment`] = 'Release'

    // ── XCConfigurationList for Watch target ──────────────────────────────────
    objects['XCConfigurationList'][configListUuid] = {
      isa: 'XCConfigurationList',
      buildConfigurations: [
        { value: debugConfigUuid,   comment: 'Debug' },
        { value: releaseConfigUuid, comment: 'Release' },
      ],
      defaultConfigurationIsVisible: 0,
      defaultConfigurationName: 'Release',
    }
    objects['XCConfigurationList'][`${configListUuid}_comment`] =
      `Build configuration list for PBXNativeTarget "${WATCH_TARGET}"`

    // ── PBXNativeTarget for Watch ─────────────────────────────────────────────
    objects['PBXNativeTarget'][watchTargetUuid] = {
      isa: 'PBXNativeTarget',
      buildConfigurationList: configListUuid,
      buildPhases: [
        { value: sourcesBuildPhaseUuid,    comment: 'Sources' },
        { value: frameworksBuildPhaseUuid, comment: 'Frameworks' },
        { value: resourcesBuildPhaseUuid,  comment: 'Resources' },
      ],
      buildRules: [],
      dependencies: [],
      name: WATCH_TARGET,
      productName: `"${WATCH_TARGET}"`,
      productReference: watchProductRefUuid,
      productType: '"com.apple.product-type.application"',
    }
    objects['PBXNativeTarget'][`${watchTargetUuid}_comment`] = WATCH_TARGET

    // Add Watch target to project's targets array
    if (projectKey && pbxProjSection[projectKey]) {
      const targets = pbxProjSection[projectKey].targets || []
      targets.push({ value: watchTargetUuid, comment: WATCH_TARGET })
      pbxProjSection[projectKey].targets = targets
    }

    // ── PBXContainerItemProxy + PBXTargetDependency ───────────────────────────
    objects['PBXContainerItemProxy'][containerItemUuid] = {
      isa: 'PBXContainerItemProxy',
      containerPortal: projectKey,
      proxyType: 1,
      remoteGlobalIDString: watchTargetUuid,
      remoteInfo: `"${WATCH_TARGET}"`,
    }
    objects['PBXContainerItemProxy'][`${containerItemUuid}_comment`] = 'PBXContainerItemProxy'

    objects['PBXTargetDependency'][targetDependencyUuid] = {
      isa: 'PBXTargetDependency',
      target: watchTargetUuid,
      targetProxy: containerItemUuid,
    }
    objects['PBXTargetDependency'][`${targetDependencyUuid}_comment`] = WATCH_TARGET

    // ── "Embed Watch Apps" CopyFiles phase on the iPhone target ───────────────
    objects['PBXCopyFilesBuildPhase'][embedPhaseUuid] = {
      isa: 'PBXCopyFilesBuildPhase',
      buildActionMask: 2147483647,
      dstPath: '"$(CONTENTS_FOLDER_PATH)/Watch"',
      dstSubfolderSpec: 16,
      files: [{ value: embedBuildFileUuid, comment: `${WATCH_TARGET}.app in Embed Watch Apps` }],
      name: '"Embed Watch Apps"',
      runOnlyForDeploymentPostprocessing: 0,
    }
    objects['PBXCopyFilesBuildPhase'][`${embedPhaseUuid}_comment`] = 'Embed Watch Apps'

    // Attach dependency + embed phase to the iPhone target
    const iPhoneTarget       = project.getFirstTarget()
    const iPhoneNativeTarget = objects['PBXNativeTarget'][iPhoneTarget.uuid]
    if (iPhoneNativeTarget) {
      iPhoneNativeTarget.dependencies = iPhoneNativeTarget.dependencies || []
      iPhoneNativeTarget.dependencies.push({ value: targetDependencyUuid, comment: WATCH_TARGET })
      iPhoneNativeTarget.buildPhases.push({ value: embedPhaseUuid, comment: 'Embed Watch Apps' })
    }

    console.log(`[withWatchApp] ✓ Watch target injected (uuid=${watchTargetUuid})`)
    return config
  })
}

// ─── Export composed plugin ────────────────────────────────────────────────────

module.exports = function withWatchApp(config) {
  config = withWatchFiles(config)
  config = withWatchXcodeTarget(config)
  return config
}
