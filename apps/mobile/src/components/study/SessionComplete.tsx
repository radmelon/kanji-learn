import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, spacing, radius, typography } from '../../theme'
import { motivationalMessage, didCrossGoal } from './SessionComplete.messaging'

interface Props {
  totalItems: number
  correctItems: number
  confidencePct: number
  newLearned: number
  burned: number
  studyTimeMs: number
  onDone: () => void
  onReview: () => void
  /** daily_stats.reviewed BEFORE this session — used to detect goal crossing */
  reviewedBefore: number
  /** user_profiles.daily_goal — used to detect goal crossing */
  dailyGoal: number
}

function formatTime(ms: number): string {
  const totalSecs = Math.round(ms / 1000)
  const mins = Math.floor(totalSecs / 60)
  const secs = totalSecs % 60
  if (mins === 0) return `${secs}s`
  if (secs === 0) return `${mins}m`
  return `${mins}m ${secs}s`
}

export function SessionComplete({ totalItems, correctItems, confidencePct, newLearned, burned, studyTimeMs, onDone, onReview, reviewedBefore, dailyGoal }: Props) {
  const accuracy = confidencePct
  const wrong = totalItems - correctItems
  const accColor = accuracy >= 60 ? colors.success : accuracy >= 35 ? colors.warning : colors.error
  const showGoalBanner = burned === 0 && didCrossGoal(reviewedBefore, totalItems, dailyGoal)

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {showGoalBanner && (
          <View style={styles.goalBanner}>
            <Text style={styles.goalBannerText}>🎉 Daily goal met — nice work.</Text>
          </View>
        )}
        {/* Hero */}
        <View style={styles.hero}>
          <Ionicons
            name={accuracy >= 60 ? 'checkmark-circle' : accuracy >= 35 ? 'star' : 'refresh-circle'}
            size={72}
            color={accColor}
          />
          <Text style={styles.title}>Session Complete</Text>
          <Text style={styles.message}>{motivationalMessage(accuracy, burned)}</Text>
        </View>

        {/* Accuracy ring + breakdown */}
        <View style={styles.accuracyCard}>
          <View style={styles.accuracyRow}>
            <View style={styles.accuracyCircle}>
              <Text style={[styles.accuracyPct, { color: accColor }]}>{accuracy}%</Text>
              <Text style={styles.accuracyLabel}>confidence</Text>
            </View>
            <View style={styles.accuracyBreakdown}>
              <View style={styles.breakdownItem}>
                <View style={[styles.breakdownDot, { backgroundColor: colors.success }]} />
                <Text style={styles.breakdownCount}>{correctItems}</Text>
                <Text style={styles.breakdownLabel}>remembered</Text>
              </View>
              <View style={styles.breakdownItem}>
                <View style={[styles.breakdownDot, { backgroundColor: colors.error }]} />
                <Text style={styles.breakdownCount}>{wrong}</Text>
                <Text style={styles.breakdownLabel}>missed</Text>
              </View>
              <View style={styles.breakdownItem}>
                <View style={[styles.breakdownDot, { backgroundColor: colors.textMuted }]} />
                <Text style={styles.breakdownCount}>{totalItems}</Text>
                <Text style={styles.breakdownLabel}>total</Text>
              </View>
            </View>
          </View>
          {/* accuracy bar */}
          <View style={styles.accBarTrack}>
            <View style={[styles.accBarFill, { width: `${accuracy}%`, backgroundColor: accColor }]} />
          </View>
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <StatChip icon="time-outline" value={formatTime(studyTimeMs)} label="Time" color={colors.primary} />
          <StatChip icon="sparkles-outline" value={String(newLearned)} label="New" color={colors.accent} />
          <StatChip icon="flame-outline" value={String(burned)} label="Burned" color={burned > 0 ? colors.burned : colors.textMuted} />
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.doneButton} onPress={onDone} activeOpacity={0.85}>
            <Text style={styles.doneText}>Back to Dashboard</Text>
          </TouchableOpacity>

          {wrong > 0 && (
            <TouchableOpacity style={styles.reviewButton} onPress={onReview} activeOpacity={0.85}>
              <Ionicons name="refresh" size={16} color={colors.textSecondary} />
              <Text style={styles.reviewText}>Drill {wrong} missed card{wrong !== 1 ? 's' : ''}</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function StatChip({ icon, value, label, color }: { icon: string; value: string; label: string; color: string }) {
  return (
    <View style={chipStyles.item}>
      <Ionicons name={icon as any} size={18} color={color} />
      <Text style={[chipStyles.value, { color }]}>{value}</Text>
      <Text style={chipStyles.label}>{label}</Text>
    </View>
  )
}

const chipStyles = StyleSheet.create({
  item: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  value: { ...typography.h2 },
  label: { ...typography.caption, color: colors.textMuted },
})

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: {
    flexGrow: 1,
    padding: spacing.xl,
    gap: spacing.lg,
    justifyContent: 'center',
  },
  hero: { alignItems: 'center', gap: spacing.sm },
  title: { ...typography.h1, color: colors.textPrimary },
  message: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },

  accuracyCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  accuracyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  accuracyCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 3,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accuracyPct: { ...typography.h2, fontWeight: '800' },
  accuracyLabel: { ...typography.caption, color: colors.textMuted },
  accuracyBreakdown: { flex: 1, gap: spacing.sm },
  breakdownItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  breakdownDot: { width: 8, height: 8, borderRadius: 4 },
  breakdownCount: { ...typography.bodySmall, color: colors.textPrimary, fontWeight: '700', width: 28 },
  breakdownLabel: { ...typography.caption, color: colors.textMuted },
  accBarTrack: {
    height: 6,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  accBarFill: { height: '100%', borderRadius: radius.full },

  statsRow: { flexDirection: 'row', gap: spacing.sm },

  actions: { gap: spacing.sm },
  doneButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  doneText: { ...typography.h3, color: '#fff' },
  reviewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reviewText: { ...typography.h3, color: colors.textSecondary },

  goalBanner: {
    alignSelf: 'center',
    marginTop: spacing.md,
    marginBottom: -spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.success + '22',
    borderWidth: 1,
    borderColor: colors.success,
  },
  goalBannerText: {
    ...typography.bodySmall,
    color: colors.success,
    fontWeight: '600',
  },
})
