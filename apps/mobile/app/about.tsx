import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import Constants from 'expo-constants'
import { colors, spacing, radius, typography } from '../src/theme'

// EAS auto-bumps ios.buildNumber on each build, so this tracks the running
// TestFlight/App Store build automatically — never hand-edit app.json.
const BUILD_NUMBER = Constants.expoConfig?.ios?.buildNumber ?? '0'
const APP_VERSION = `1.0.${BUILD_NUMBER}`

// ─── About Screen ─────────────────────────────────────────────────────────────

export default function AboutScreen() {
  const router = useRouter()

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>About</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* App identity */}
        <View style={styles.hero}>
          <View style={styles.logoBox}>
            <Text style={styles.logoKanji}>漢</Text>
          </View>
          <Text style={styles.appName}>Kanji Learn</Text>
          <Text style={styles.appVersion}>Version {APP_VERSION}</Text>
        </View>

        {/* KANJIDIC2 attribution — required by CC BY-SA 4.0 */}
        <AttributionCard
          title="Kanji Reference Data"
          badge="CC BY-SA 4.0"
          badgeColor={colors.info}
          icon="library"
        >
          <Text style={styles.attrBody}>
            Kanji reference codes (JIS codes, Nelson indices, Morohashi numbers) are sourced
            from <Text style={styles.bold}>KANJIDIC2</Text>, compiled by{' '}
            <Text style={styles.bold}>Jim Breen</Text> and the{' '}
            <Text style={styles.bold}>
              Electronic Dictionary Research and Development Group
            </Text>{' '}
            (EDRDG).
          </Text>
          <Text style={styles.attrBody}>
            KANJIDIC2 is distributed under the{' '}
            <Text
              style={styles.link}
              onPress={() =>
                Linking.openURL('https://creativecommons.org/licenses/by-sa/4.0/')
              }
            >
              Creative Commons Attribution-ShareAlike 4.0
            </Text>{' '}
            licence. We gratefully acknowledge the EDRDG's work in making this data freely
            available to learners worldwide.
          </Text>
          <TouchableOpacity
            style={styles.attrLink}
            onPress={() => Linking.openURL('https://www.edrdg.org/wiki/index.php/KANJIDIC_Project')}
          >
            <Ionicons name="open-outline" size={14} color={colors.accent} />
            <Text style={styles.attrLinkText}>edrdg.org — KANJIDIC Project</Text>
          </TouchableOpacity>
        </AttributionCard>

        {/* KanjiVG attribution */}
        <AttributionCard
          title="Stroke Order Data"
          badge="CC BY-SA 3.0"
          badgeColor={colors.info}
          icon="pencil"
        >
          <Text style={styles.attrBody}>
            Stroke order animations are powered by{' '}
            <Text style={styles.bold}>KanjiVG</Text>, created by{' '}
            <Text style={styles.bold}>Ulrich Apel</Text>. KanjiVG provides SVG stroke data
            for over 6,000 kanji.
          </Text>
          <TouchableOpacity
            style={styles.attrLink}
            onPress={() => Linking.openURL('https://kanjivg.tagaini.net')}
          >
            <Ionicons name="open-outline" size={14} color={colors.accent} />
            <Text style={styles.attrLinkText}>kanjivg.tagaini.net</Text>
          </TouchableOpacity>
        </AttributionCard>

        {/* AI / Anthropic attribution */}
        <AttributionCard
          title="AI-Generated Mnemonics"
          badge="Anthropic"
          badgeColor={colors.primary}
          icon="sparkles"
        >
          <Text style={styles.attrBody}>
            Mnemonic hooks and memory stories are generated using{' '}
            <Text style={styles.bold}>Claude</Text> by Anthropic. AI-generated content is
            clearly labelled throughout the app. You can always edit or replace any hook
            with your own words.
          </Text>
          <TouchableOpacity
            style={styles.attrLink}
            onPress={() => Linking.openURL('https://anthropic.com')}
          >
            <Ionicons name="open-outline" size={14} color={colors.accent} />
            <Text style={styles.attrLinkText}>anthropic.com</Text>
          </TouchableOpacity>
        </AttributionCard>

        {/* Open source */}
        <AttributionCard
          title="Open Source Libraries"
          badge="Various licences"
          badgeColor={colors.textMuted}
          icon="code-slash"
        >
          <Text style={styles.attrBody}>
            Kanji Learn is built on React Native, Expo, Fastify, Drizzle ORM, wanakana,
            react-native-svg, and many other open-source projects. We thank every
            contributor whose work makes this app possible.
          </Text>
        </AttributionCard>

        {/* Footer */}
        <Text style={styles.footer}>
          Made with 愛 for Japanese learners everywhere.
        </Text>
      </ScrollView>
    </SafeAreaView>
  )
}

// ─── Attribution card ─────────────────────────────────────────────────────────

interface CardProps {
  title: string
  badge: string
  badgeColor: string
  icon: keyof typeof Ionicons.glyphMap
  children: React.ReactNode
}

function AttributionCard({ title, badge, badgeColor, icon, children }: CardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardIconBox}>
          <Ionicons name={icon} size={18} color={colors.primary} />
        </View>
        <Text style={styles.cardTitle}>{title}</Text>
        <View style={[styles.badge, { backgroundColor: badgeColor + '22', borderColor: badgeColor + '44' }]}>
          <Text style={[styles.badgeText, { color: badgeColor }]}>{badge}</Text>
        </View>
      </View>
      <View style={styles.cardBody}>{children}</View>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  scroll: { flex: 1 },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },

  // Hero
  hero: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  logoBox: {
    width: 80,
    height: 80,
    borderRadius: radius.xl,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  logoKanji: {
    fontSize: 44,
    color: colors.primary,
  },
  appName: {
    ...typography.h2,
    color: colors.textPrimary,
  },
  appVersion: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },

  // Cards
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cardIconBox: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.primary + '18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '600',
    flex: 1,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  cardBody: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  attrBody: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  bold: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  link: {
    color: colors.accent,
    textDecorationLine: 'underline',
  },
  attrLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.xs,
  },
  attrLinkText: {
    ...typography.caption,
    color: colors.accent,
  },

  // Footer
  footer: {
    ...typography.bodySmall,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
})
