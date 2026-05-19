import { useState, useEffect } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { api } from '../../lib/api'
import { colors, spacing, radius, typography } from '../../theme'

interface Props {
  /** The learner's daily minutes budget. */
  goalMinutes: number
  onBegin: () => void
}

/**
 * The Practice Loop's Ready screen (spec §5 screen 1) — today's plan: the
 * minutes budget and the due-review count, with a Begin action. Shown when the
 * learner opens the Study tab before a session has started.
 */
export function ReadyScreen({ goalMinutes, onBegin }: Props) {
  const [dueCount, setDueCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    api.get<{ dueCount: number }>('/v1/review/status')
      .then((s) => { if (!cancelled) setDueCount(s.dueCount) })
      .catch(() => { if (!cancelled) setDueCount(null) })
    return () => { cancelled = true }
  }, [])

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.content}>
        <Ionicons name="book" size={64} color={colors.primary} />
        <Text style={styles.title}>Today's practice</Text>
        <Text style={styles.subtitle}>
          A {goalMinutes}-minute session. Each kanji is routed through the
          modalities it needs.
        </Text>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{goalMinutes}</Text>
            <Text style={styles.statLabel}>minutes</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{dueCount === null ? '—' : dueCount}</Text>
            <Text style={styles.statLabel}>reviews due</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.beginBtn} onPress={onBegin} activeOpacity={0.85}>
          <Text style={styles.beginText}>Begin</Text>
          <Ionicons name="arrow-forward" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xl, gap: spacing.lg,
  },
  title: { ...typography.h1, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  statsRow: { flexDirection: 'row', gap: spacing.md, width: '100%' },
  statCard: {
    flex: 1, alignItems: 'center', gap: spacing.xs,
    backgroundColor: colors.bgCard, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.lg,
  },
  statValue: { ...typography.h1, color: colors.textPrimary },
  statLabel: { ...typography.caption, color: colors.textMuted },
  beginBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.primary, borderRadius: radius.lg,
    paddingVertical: spacing.md, paddingHorizontal: spacing.xxl, marginTop: spacing.md,
  },
  beginText: { ...typography.h3, color: '#fff' },
})
