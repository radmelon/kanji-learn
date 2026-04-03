/**
 * Expo config plugin: Xcode 16/26 build compatibility fixes.
 *
 * Applied automatically on every `expo prebuild`. Handles:
 *   - fmt consteval → constexpr (Apple clang 16 enforcement)
 *   - GCC_TREAT_WARNINGS_AS_ERRORS = NO (RN 0.81 warnings)
 *   - ENABLE_USER_SCRIPT_SANDBOXING = NO (ip.txt write blocked by sandbox)
 *   - Warning suppression flags for ObjC/C++ pods
 *   - AppDelegate bundleURL() reads ip.txt directly (bypasses isPackagerRunning
 *     check that fails before iOS grants Local Network permission)
 *   - CLANG_CXX_LANGUAGE_STANDARD = c++20 (Xcode 26 defaults to C++23 which
 *     causes std::expected / folly::Expected collision and std::thread errors)
 *   - FOLLY_NO_CONFIG=1 (disables Folly's C++23 feature auto-detection)
 */
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins')
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
        config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++20'
        config.build_settings['OTHER_CPLUSPLUSFLAGS'] = "\$(inherited) \#{cflags} -std=c++20 -DFMT_USE_CONSTEVAL=0 -DFMT_CONSTEVAL= -DFOLLY_NO_CONFIG=1 -DFOLLY_CFG_NO_COROUTINES=1"
      end
    end
    # Patch FMT_CONSTEVAL in both base.h (fmt 10+) and core.h (fmt 9)
    %w[base.h core.h].each do |header|
      fmt_header = Dir.glob("\#{installer.sandbox.root}/**/fmt/\#{header}").first
      next unless fmt_header && File.exist?(fmt_header)
      content = File.read(fmt_header)
      if content.include?('#  define FMT_CONSTEVAL consteval')
        File.write(fmt_header, content.sub(
          '#  define FMT_CONSTEVAL consteval',
          '#  define FMT_CONSTEVAL constexpr  /* patched: Xcode 16 */'
        ))
        puts "withXcode16Fix: patched FMT_CONSTEVAL in fmt/\#{header}"
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

      // Inject our fixes just before the final `  end\nend` that closes the
      // post_install block + target block. The multiline react_native_post_install()
      // call breaks character-class regexes, so we anchor to the file tail instead.
      podfile = podfile.replace(
        /(\n  end\nend\n?)$/,
        '\n' + PODFILE_POST_INSTALL + '\n  end\nend\n'
      )

      fs.writeFileSync(podfilePath, podfile)
      return config
    },
  ])
}

// Patch AppDelegate.swift: read ip.txt directly in bundleURL() to bypass the
// isPackagerRunning() check, which blocks before iOS grants Local Network permission.
function withAppDelegateFix(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const appName = config.modRequest.projectName
      const appDelegatePath = path.join(
        config.modRequest.platformProjectRoot,
        appName,
        'AppDelegate.swift'
      )
      if (!fs.existsSync(appDelegatePath)) return config

      let src = fs.readFileSync(appDelegatePath, 'utf8')
      if (src.includes('ip.txt')) return config // already patched

      src = src.replace(
        /override func bundleURL\(\) -> URL\? \{[\s\S]*?#if DEBUG[\s\S]*?return RCTBundleURLProvider\.sharedSettings\(\)\.jsBundleURL\(forBundleRoot:.*?\)[\s\S]*?#else[\s\S]*?return Bundle\.main\.url\(forResource:.*?\)[\s\S]*?#endif[\s\S]*?\}/,
        `override func bundleURL() -> URL? {
#if DEBUG
    // Read ip.txt directly to bypass isPackagerRunning(), which fails on physical
    // devices before iOS grants Local Network permission (iOS 14+).
    let ipPath = Bundle.main.path(forResource: "ip", ofType: "txt")
    let host = (try? String(contentsOfFile: ipPath ?? "", encoding: .utf8))?
      .trimmingCharacters(in: .whitespacesAndNewlines) ?? "localhost"
    return URL(string: "http://\\(host):8081/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }`
      )

      fs.writeFileSync(appDelegatePath, src)
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
        settings.CLANG_CXX_LANGUAGE_STANDARD = '"c++20"'
      }
    })

    return config
  })
}

module.exports = function withXcode16Fix(config) {
  config = withPodfileFix(config)
  config = withXcprojFix(config)
  config = withAppDelegateFix(config)
  return config
}
