import { useCallback } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, RefreshControl, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuthStore } from '../../src/stores/auth.store'
import { useAnalytics } from '../../src/hooks/useAnalytics'
import { useInterventions } from '../../src/hooks/useInterventions'
import { useSocial } from '../../src/hooks/useSocial'
import { SrsStatusBar } from '../../src/components/ui/SrsStatusBar'
import { StatCard } from '../../src/components/ui/StatCard'
import { InterventionBanner } from '../../src/components/ui/InterventionBanner'
import { colors, spacing, radius, typography } from '../../src/theme'

export default function Dashboard() {
  const router = useRouter()
  const { user } = useAuthStore()
  const { summary, isLoading, refresh } = useAnalytics()
  const { interventions, dismiss } = useInterventions()
  const { leaderboard } = useSocial()

  const handleStudy = useCallback(() => {
    router.push('/(tabs)/study')
  }, [router])

  const handleQuiz = useCallback(() => {
    router.push('/test')
  }, [router])

  const displayName = user?.user_metadata?.display_name ?? user?.email?.split('@')[0] ?? 'Learner'

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Good {getTimeOfDay()},</Text>
            <Text style={styles.name}>{displayName}</Text>
          </View>
          <View style={styles.streakBadge}>
            <Ionicons name="flame" size={18} color={colors.accent} />
            <Text style={styles.streakText}>
              {summary?.streakDays ?? 0}
            </Text>
          </View>
        </View>

        {/* Intervention banners */}
        {interventions.map((i) => (
          <InterventionBanner key={i.id} intervention={i} onDismiss={() => dismiss(i.id)} />
        ))}

        {/* Start study CTA */}
        <TouchableOpacity style={styles.studyButton} onPress={handleStudy} activeOpacity={0.85}>
          <Ionicons name="book" size={22} color="#fff" />
          <Text style={styles.studyButtonText}>Start Today's Reviews</Text>
          <Ionicons name="arrow-forward" size={18} color="rgba(255,255,255,0.7)" />
        </TouchableOpacity>

        {/* Take a Quiz CTA */}
        <TouchableOpacity style={styles.quizButton} onPress={handleQuiz} activeOpacity={0.85}>
          <Ionicons name="help-circle" size={22} color={colors.accent} />
          <Text style={styles.quizButtonText}>Take a Quiz</Text>
          <Ionicons name="arrow-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        {isLoading && !summary ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
        ) : summary ? (
          <>
            {/* Stats row */}
            <View style={styles.statsRow}>
              <StatCard
                label="Accuracy"
                value={`${summary.accuracy}%`}
                subtitle="last 30 days"
                accentColor={colors.success}
              />
              <StatCard
                label="Daily avg"
                value={summary.velocity.dailyAverage}
                subtitle="reviews/day"
                accentColor={colors.accent}
              />
              <StatCard
                label="Burned"
                value={summary.statusCounts.burned.toLocaleString()}
                subtitle={`of 2,136`}
                accentColor={colors.burned}
              />
            </View>

            {/* SRS breakdown */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Kanji Status</Text>
              <SrsStatusBar counts={summary.statusCounts} />
            </View>

            {/* Velocity trend */}
            <View style={styles.card}>
              <View style={styles.cardRow}>
                <Text style={styles.cardTitle}>Velocity</Text>
                <TrendBadge trend={summary.velocity.trend} />
              </View>
              <Text style={styles.velocityValue}>
                {summary.velocity.weeklyAverage}
                <Text style={styles.velocityUnit}> reviews/day this week</Text>
              </Text>
              {summary.velocity.projectedCompletion && (
                <Text style={styles.projection}>
                  At this pace: complete by{' '}
                  {new Date(summary.velocity.projectedCompletion).toLocaleDateString('en', {
                    year: 'numeric', month: 'short',
                  })}
                </Text>
              )}
            </View>

            {/* Recent activity */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Last 7 Days</Text>
              <View style={styles.activityBars}>
                {summary.recentStats.slice(0, 7).reverse().map((day) => (
                  <ActivityBar key={day.date} day={day} />
                ))}
              </View>
            </View>

            {/* Completion */}
            <View style={styles.card}>
              <View style={styles.cardRow}>
                <Text style={styles.cardTitle}>Journey</Text>
                <Text style={styles.completionPct}>{summary.completionPct}% complete</Text>
              </View>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.max(summary.completionPct, 1)}%` },
                  ]}
                />
              </View>
              <Text style={styles.progressLabel}>
                {summary.totalSeen.toLocaleString()} seen · {summary.statusCounts.burned.toLocaleString()} mastered · {summary.statusCounts.unseen.toLocaleString()} remaining
              </Text>
            </View>
          </>
        ) : null}

        {/* Leaderboard */}
        {leaderboard.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardRow}>
              <Text style={styles.cardTitle}>Leaderboard</Text>
              <Text style={styles.lbSubtitle}>
                {leaderboard.some((e) => !e.isMe) ? 'Study mates' : 'Global top 10'}
              </Text>
            </View>
            {leaderboard.map((entry, i) => (
              <View key={entry.userId} style={[styles.lbRow, entry.isMe && styles.lbRowMe]}>
                <Text style={styles.lbRank}>{i + 1}</Text>
                <View style={styles.lbInfo}>
                  <Text style={[styles.lbName, entry.isMe && styles.lbNameMe]} numberOfLines={1}>
                    {entry.displayName ?? entry.email ?? 'Unknown'}
                    {entry.isMe ? ' (you)' : ''}
                  </Text>
                  <Text style={styles.lbStats}>
                    {entry.totalReviewed.toLocaleString()} reviewed · {entry.totalBurned.toLocaleString()} burned
                  </Text>
                </View>
                <View style={styles.lbStreak}>
                  <Ionicons name="flame" size={14} color={entry.streak > 0 ? colors.accent : colors.textMuted} />
                  <Text style={[styles.lbStreakText, { color: entry.streak > 0 ? colors.accent : colors.textMuted }]}>
                    {entry.streak}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TrendBadge({ trend }: { trend: 'up' | 'down' | 'stable' }) {
  const config = {
    up: { icon: 'trending-up' as const, color: colors.success, label: 'Up' },
    down: { icon: 'trending-down' as const, color: colors.error, label: 'Down' },
    stable: { icon: 'remove' as const, color: colors.textMuted, label: 'Stable' },
  }[trend]

  return (
    <View style={[trendStyles.badge, { backgroundColor: config.color + '22' }]}>
      <Ionicons name={config.icon} size={14} color={config.color} />
      <Text style={[trendStyles.label, { color: config.color }]}>{config.label}</Text>
    </View>
  )
}

const trendStyles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full },
  label: { ...typography.caption, fontWeight: '600' },
})

function ActivityBar({ day }: { day: { date: string; reviewed: number } }) {
  const MAX = 50
  const pct = Math.min((day.reviewed / MAX) * 100, 100)
  const weekday = new Date(day.date + 'T00:00:00').toLocaleDateString('en', { weekday: 'narrow' })

  return (
    <View style={barStyles.container}>
      <View style={barStyles.track}>
        <View style={[barStyles.fill, { height: `${Math.max(pct, 4)}%` }]} />
      </View>
      <Text style={barStyles.label}>{weekday}</Text>
    </View>
  )
}

const barStyles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', gap: 4 },
  track: { flex: 1, width: '60%', backgroundColor: colors.bgSurface, borderRadius: radius.sm, justifyContent: 'flex-end', overflow: 'hidden' },
  fill: { width: '100%', backgroundColor: colors.primary, borderRadius: radius.sm },
  label: { ...typography.caption, color: colors.textMuted },
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTimeOfDay() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  greeting: { ...typography.bodySmall, color: colors.textSecondary },
  name: { ...typography.h2, color: colors.textPrimary },
  streakBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.bgCard, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border },
  streakText: { ...typography.h3, color: colors.accent },
  studyButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.lg, paddingVertical: spacing.md + 2, paddingHorizontal: spacing.lg },
  studyButtonText: { ...typography.h3, color: '#fff', flex: 1, textAlign: 'center' },
  quizButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.bgCard, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  quizButtonText: { ...typography.h3, color: colors.textPrimary, flex: 1, textAlign: 'center' },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  card: { backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  cardTitle: { ...typography.h3, color: colors.textPrimary },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  velocityValue: { ...typography.h2, color: colors.textPrimary },
  velocityUnit: { ...typography.body, color: colors.textSecondary, fontWeight: '400' },
  projection: { ...typography.caption, color: colors.textMuted },
  activityBars: { flexDirection: 'row', height: 80, gap: spacing.xs, alignItems: 'flex-end' },
  progressTrack: { height: 8, backgroundColor: colors.bgSurface, borderRadius: radius.full, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: radius.full },
  progressLabel: { ...typography.caption, color: colors.textMuted },
  completionPct: { ...typography.bodySmall, color: colors.primary, fontWeight: '600' },

  // Leaderboard
  lbSubtitle: { ...typography.caption, color: colors.textMuted },
  lbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  lbRowMe: { backgroundColor: colors.primary + '11', borderRadius: radius.sm, paddingHorizontal: spacing.xs },
  lbRank: { ...typography.bodySmall, color: colors.textMuted, fontWeight: '700', width: 20, textAlign: 'center' },
  lbInfo: { flex: 1, gap: 1 },
  lbName: { ...typography.body, color: colors.textPrimary },
  lbNameMe: { color: colors.primary, fontWeight: '600' },
  lbStats: { ...typography.caption, color: colors.textMuted },
  lbStreak: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  lbStreakText: { ...typography.bodySmall, fontWeight: '700' },
})
