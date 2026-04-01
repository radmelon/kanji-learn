import { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useAuthStore } from '../../src/stores/auth.store'
import { useAnalytics } from '../../src/hooks/useAnalytics'
import { SrsStatusBar } from '../../src/components/ui/SrsStatusBar'
import { colors, spacing, radius, typography } from '../../src/theme'
import type { DailyStats } from '@kanji-learn/shared'
import { JLPT_LEVELS, JLPT_KANJI_COUNTS } from '@kanji-learn/shared'

type Period = '7d' | '30d' | '90d'

const PERIOD_DAYS: Record<Period, number> = { '7d': 7, '30d': 30, '90d': 90 }

export default function ProgressScreen() {
  const { user } = useAuthStore()
  const { summary, isLoading, error, refresh } = useAnalytics()
  const [period, setPeriod] = useState<Period>('30d')

  const displayName = user?.user_metadata?.display_name ?? 'Learner'

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Progress</Text>
          <Text style={styles.subtitle}>{displayName}'s journey</Text>
        </View>

        {isLoading && !summary ? (
          <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: spacing.xxl }} />
        ) : error ? (
          <View style={styles.errorBox}>
            <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
            <Text style={styles.errorText}>Could not load progress</Text>
            <Text style={styles.errorSub}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={refresh}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : summary ? (
          <>
            {/* Streak + completion hero */}
            <View style={styles.heroRow}>
              <HeroStat
                icon="flame"
                iconColor={colors.accent}
                value={`${summary.streakDays}`}
                label="Day streak"
              />
              <HeroStat
                icon="checkmark-circle"
                iconColor={colors.success}
                value={`${summary.completionPct}%`}
                label="Complete"
              />
              <HeroStat
                icon="trending-up"
                iconColor={colors.primary}
                value={`${summary.velocity.weeklyAverage}`}
                label="Reviews/day"
              />
            </View>

            {/* Overall SRS breakdown */}
            <Section title="Kanji Breakdown">
              <SrsStatusBar counts={summary.statusCounts} />
              <JlptGrid jlptProgress={summary.jlptProgress} />
            </Section>

            {/* Period selector + activity chart */}
            <Section
              title="Activity"
              right={
                <PeriodSelector value={period} onChange={setPeriod} />
              }
            >
              <ActivityChart
                stats={summary.recentStats}
                days={PERIOD_DAYS[period]}
              />
            </Section>

            {/* Accuracy card */}
            <Section title="Accuracy">
              <View style={styles.accuracyRow}>
                <View style={styles.accuracyCircle}>
                  <Text style={styles.accuracyPct}>{summary.accuracy}%</Text>
                  <Text style={styles.accuracyLabel}>correct</Text>
                </View>
                <View style={styles.accuracyDetails}>
                  <AccuracyRow label="Last 7 days" value={summary.accuracy} />
                  <AccuracyRow label="Total reviewed" value={summary.statusCounts.learning + summary.statusCounts.reviewing + summary.statusCounts.remembered + summary.statusCounts.burned} isCount />
                  <AccuracyRow label="Burned" value={summary.statusCounts.burned} isCount />
                </View>
              </View>
            </Section>

            {/* Velocity card */}
            <Section title="Velocity">
              <View style={styles.velocityGrid}>
                <VelocityItem label="Daily avg (30d)" value={summary.velocity.dailyAverage} unit="reviews" />
                <VelocityItem label="Weekly avg" value={summary.velocity.weeklyAverage} unit="reviews/day" />
                {summary.velocity.projectedCompletion && (
                  <VelocityItem
                    label="Est. completion"
                    value={new Date(summary.velocity.projectedCompletion).toLocaleDateString('en', { month: 'short', year: 'numeric' })}
                    isText
                  />
                )}
                <VelocityItem
                  label="Trend"
                  value={summary.velocity.trend === 'up' ? '↑ Up' : summary.velocity.trend === 'down' ? '↓ Down' : '→ Stable'}
                  isText
                  color={
                    summary.velocity.trend === 'up'
                      ? colors.success
                      : summary.velocity.trend === 'down'
                      ? colors.error
                      : colors.textMuted
                  }
                />
              </View>
            </Section>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function HeroStat({ icon, iconColor, value, label }: { icon: string; iconColor: string; value: string; label: string }) {
  return (
    <View style={heroStyles.item}>
      <Ionicons name={icon as any} size={24} color={iconColor} />
      <Text style={heroStyles.value}>{value}</Text>
      <Text style={heroStyles.label}>{label}</Text>
    </View>
  )
}

const heroStyles = StyleSheet.create({
  item: { flex: 1, alignItems: 'center', backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.md, gap: 4, borderWidth: 1, borderColor: colors.border },
  value: { ...typography.h2, color: colors.textPrimary },
  label: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
})

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={sectionStyles.container}>
      <View style={sectionStyles.header}>
        <Text style={sectionStyles.title}>{title}</Text>
        {right}
      </View>
      <View style={sectionStyles.body}>{children}</View>
    </View>
  )
}

const sectionStyles = StyleSheet.create({
  container: { gap: spacing.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...typography.h3, color: colors.textPrimary },
  body: { backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md, borderWidth: 1, borderColor: colors.border },
})

function PeriodSelector({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <View style={periodStyles.container}>
      {(['7d', '30d', '90d'] as Period[]).map((p) => (
        <TouchableOpacity
          key={p}
          style={[periodStyles.btn, value === p && periodStyles.active]}
          onPress={() => onChange(p)}
        >
          <Text style={[periodStyles.label, value === p && periodStyles.activeLabel]}>{p}</Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

const periodStyles = StyleSheet.create({
  container: { flexDirection: 'row', backgroundColor: colors.bgSurface, borderRadius: radius.md, padding: 2 },
  btn: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm - 2 },
  active: { backgroundColor: colors.primary },
  label: { ...typography.caption, color: colors.textMuted },
  activeLabel: { color: '#fff', fontWeight: '700' },
})

function ActivityChart({ stats, days }: { stats: DailyStats[]; days: number }) {
  const recent = stats.slice(0, days).reverse()
  const max = Math.max(...recent.map((d) => d.reviewed), 1)

  return (
    <View style={chartStyles.container}>
      <View style={chartStyles.bars}>
        {recent.map((day, i) => {
          const pct = (day.reviewed / max) * 100
          const correctPct = day.reviewed > 0 ? (day.correct / day.reviewed) * 100 : 0
          return (
            <View key={i} style={chartStyles.barWrapper}>
              <View style={chartStyles.track}>
                <View style={[chartStyles.barBg, { height: `${Math.max(pct, 2)}%` }]} />
                <View style={[chartStyles.barFg, { height: `${Math.max(correctPct * pct / 100, 2)}%`, backgroundColor: colors.success }]} />
              </View>
            </View>
          )
        })}
      </View>
      <View style={chartStyles.legend}>
        <LegendDot color={colors.primary} label="Reviewed" />
        <LegendDot color={colors.success} label="Correct" />
      </View>
    </View>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ ...typography.caption, color: colors.textMuted }}>{label}</Text>
    </View>
  )
}

const chartStyles = StyleSheet.create({
  container: { gap: spacing.sm },
  bars: { flexDirection: 'row', height: 100, gap: 2, alignItems: 'flex-end' },
  barWrapper: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  track: { width: '100%', height: '100%', justifyContent: 'flex-end', backgroundColor: colors.bgSurface, borderRadius: 3, overflow: 'hidden', position: 'relative' },
  barBg: { position: 'absolute', bottom: 0, width: '100%', backgroundColor: colors.primary + '44', borderRadius: 3 },
  barFg: { position: 'absolute', bottom: 0, width: '100%', borderRadius: 3 },
  legend: { flexDirection: 'row', gap: spacing.md },
})

function JlptGrid({ jlptProgress }: { jlptProgress: Record<string, number> }) {
  return (
    <View style={jlptStyles.grid}>
      {JLPT_LEVELS.map((level) => {
        const levelTotal = JLPT_KANJI_COUNTS[level]
        const seen = jlptProgress[level] ?? 0
        const pct = Math.min((seen / levelTotal) * 100, 100)
        return (
          <View key={level} style={jlptStyles.row}>
            <Text style={jlptStyles.level}>{level}</Text>
            <View style={jlptStyles.track}>
              <View style={[jlptStyles.fill, { width: `${pct}%` }]} />
            </View>
            <Text style={jlptStyles.count}>{seen}/{levelTotal}</Text>
          </View>
        )
      })}
    </View>
  )
}

const jlptStyles = StyleSheet.create({
  grid: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  level: { ...typography.caption, color: colors.textMuted, width: 24, fontWeight: '700' },
  track: { flex: 1, height: 6, backgroundColor: colors.bgSurface, borderRadius: radius.full, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.burned, borderRadius: radius.full },
  count: { ...typography.caption, color: colors.textMuted, width: 64, textAlign: 'right' },
})

function AccuracyRow({ label, value, isCount }: { label: string; value: number; isCount?: boolean }) {
  return (
    <View style={accStyles.row}>
      <Text style={accStyles.label}>{label}</Text>
      <Text style={accStyles.value}>{isCount ? value.toLocaleString() : `${value}%`}</Text>
    </View>
  )
}

const accStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  label: { ...typography.bodySmall, color: colors.textSecondary },
  value: { ...typography.bodySmall, color: colors.textPrimary, fontWeight: '600' },
})

function VelocityItem({ label, value, unit, isText, color }: { label: string; value: string | number; unit?: string; isText?: boolean; color?: string }) {
  return (
    <View style={velStyles.item}>
      <Text style={velStyles.label}>{label}</Text>
      <Text style={[velStyles.value, color ? { color } : {}]}>
        {value}{unit && !isText ? <Text style={velStyles.unit}> {unit}</Text> : null}
      </Text>
    </View>
  )
}

const velStyles = StyleSheet.create({
  item: { flex: 1, minWidth: '45%' },
  label: { ...typography.caption, color: colors.textMuted },
  value: { ...typography.h3, color: colors.textPrimary },
  unit: { ...typography.caption, color: colors.textMuted, fontWeight: '400' },
})

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl },
  header: { gap: 2 },
  title: { ...typography.h1, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary },
  heroRow: { flexDirection: 'row', gap: spacing.sm },
  accuracyRow: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center' },
  accuracyCircle: {
    width: 90, height: 90, borderRadius: 45,
    borderWidth: 3, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  accuracyPct: { ...typography.h2, color: colors.primary },
  accuracyLabel: { ...typography.caption, color: colors.textMuted },
  accuracyDetails: { flex: 1, gap: spacing.xs },
  velocityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  errorBox: { alignItems: 'center', gap: spacing.md, marginTop: spacing.xxl, padding: spacing.xl },
  errorText: { ...typography.h3, color: colors.textPrimary },
  errorSub: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center' },
  retryBtn: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, borderRadius: radius.lg },
  retryText: { ...typography.body, color: '#fff', fontWeight: '600' },
})
