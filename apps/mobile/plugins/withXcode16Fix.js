/**
 * Expo config plugin: Xcode 16 build compatibility fixes.
 *
 * Applied automatically on every `expo prebuild`. Handles:
 *   - fmt consteval → constexpr (Apple clang 16 enforcement)
 *   - GCC_TREAT_WARNINGS_AS_ERRORS = NO (RN 0.81 warnings)
 *   - ENABLE_USER_SCRIPT_SANDBOXING = NO (ip.txt write blocked by sandbox)
 *   - Warning suppression flags for ObjC/C++ pods
 */
const { withDangerousMod, withXcodeProject } = require('@expo/config-plugins')
const fs = require('fs')
const path = require('path')

const PODFILE_POST_INSTALL = `
    # ── Xcode 16 compatibility fixes ─────────────────────────────────────────
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['GCC_TREAT_WARNINGS_AS_ERRORS']   = 'NO'
        config.build_settings['SWIFT_TREAT_WARNINGS_AS_ERRORS'] = 'NO'
        config.build_settings['ENABLE_USER_SCRIPT_SANDBOXING']  = 'NO'
        cflags = %w[
          -Wno-implicit-int-conversion
          -Wno-shorten-64-to-32
          -Wno-deprecated-declarations
          -Wno-comma
          -Wno-nullability-completeness
          -Wno-nullability-extension
          -Wno-incompatible-pointer-types
        ].join(' ')
        config.build_settings['OTHER_CFLAGS']         = "\$(inherited) \#{cflags}"
        config.build_settings['OTHER_CPLUSPLUSFLAGS'] = "\$(inherited) \#{cflags} -DFMT_USE_CONSTEVAL=0"
      end
    end
    fmt_base = Dir.glob("\#{installer.sandbox.root}/**/fmt/base.h").first
    if fmt_base && File.exist?(fmt_base)
      content = File.read(fmt_base)
      if content.include?('#  define FMT_CONSTEVAL consteval')
        File.write(fmt_base, content.sub(
          '#  define FMT_CONSTEVAL consteval',
          '#  define FMT_CONSTEVAL constexpr  /* patched: Xcode 16 */'
        ))
      end
    end
`

// Patch Podfile: inject post_install block
function withPodfileFix(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile')
      if (!fs.existsSync(podfilePath)) return config

      let podfile = fs.readFileSync(podfilePath, 'utf8')
      if (podfile.includes('Xcode 16 compatibility fixes')) return config

      podfile = podfile.replace(
        /(\s+react_native_post_install\([^)]+\)\s*\n\s*end\s*\nend)/,
        (match) => match.replace(
          /(\s+end\s*\nend)$/,
          PODFILE_POST_INSTALL + '\n  end\nend'
        )
      )

      fs.writeFileSync(podfilePath, podfile)
      return config
    },
  ])
}

// Patch main xcodeproj: set ENABLE_USER_SCRIPT_SANDBOXING = NO on app target
function withXcprojFix(config) {
  return withXcodeProject(config, (config) => {
    const project = config.modResults
    const configurations = project.pbxXCBuildConfigurationSection()

    Object.values(configurations).forEach((buildConfig) => {
      if (typeof buildConfig !== 'object' || !buildConfig.buildSettings) return
      const settings = buildConfig.buildSettings
      // Only patch the app target configs (they have PRODUCT_NAME = KanjiLearn)
      if (settings.PRODUCT_NAME === 'KanjiLearn' || settings.PRODUCT_NAME === '"KanjiLearn"') {
        settings.ENABLE_USER_SCRIPT_SANDBOXING = 'NO'
        settings.GCC_TREAT_WARNINGS_AS_ERRORS = 'NO'
      }
    })

    return config
  })
}

module.exports = function withXcode16Fix(config) {
  config = withPodfileFix(config)
  config = withXcprojFix(config)
  return config
}
