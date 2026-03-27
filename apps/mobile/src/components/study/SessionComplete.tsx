import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, spacing, radius, typography } from '../../theme'

interface Props {
  totalItems: number
  correctItems: number
  newLearned: number
  burned: number
  onDone: () => void
  onReview: () => void
}

export function SessionComplete({ totalItems, correctItems, newLearned, burned, onDone, onReview }: Props) {
  const accuracy = totalItems > 0 ? Math.round((correctItems / totalItems) * 100) : 0

  return (
    <View style={styles.container}>
      <Ionicons name="checkmark-circle" size={64} color={colors.success} />
      <Text style={styles.title}>Session Complete!</Text>

      <View style={styles.statsGrid}>
        <StatItem label="Reviewed" value={totalItems} icon="book-outline" />
        <StatItem label="Correct" value={`${accuracy}%`} icon="checkmark-outline" color={colors.success} />
        <StatItem label="New" value={newLearned} icon="sparkles-outline" color={colors.accent} />
        <StatItem label="Burned" value={burned} icon="flame-outline" color={colors.burned} />
      </View>

      <TouchableOpacity style={styles.doneButton} onPress={onDone} activeOpacity={0.85}>
        <Text style={styles.doneText}>Back to Dashboard</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.reviewButton} onPress={onReview} activeOpacity={0.85}>
        <Text style={styles.reviewText}>Review Mistakes</Text>
      </TouchableOpacity>
    </View>
  )
}

function StatItem({
  label,
  value,
  icon,
  color = colors.textPrimary,
}: {
  label: string
  value: string | number
  icon: string
  color?: string
}) {
  return (
    <View style={statStyles.item}>
      <Ionicons name={icon as any} size={20} color={color} />
      <Text style={[statStyles.value, { color }]}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
    </View>
  )
}

const statStyles = StyleSheet.create({
  item: { flex: 1, alignItems: 'center', gap: 4, backgroundColor: colors.bgCard, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  value: { ...typography.h2 },
  label: { ...typography.caption, color: colors.textMuted },
})

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg, backgroundColor: colors.bg },
  title: { ...typography.h1, color: colors.textPrimary },
  statsGrid: { flexDirection: 'row', gap: spacing.sm, width: '100%' },
  doneButton: { width: '100%', backgroundColor: colors.primary, borderRadius: radius.lg, paddingVertical: spacing.md, alignItems: 'center' },
  doneText: { ...typography.h3, color: '#fff' },
  reviewButton: { width: '100%', backgroundColor: colors.bgCard, borderRadius: radius.lg, paddingVertical: spacing.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  reviewText: { ...typography.h3, color: colors.textSecondary },
})
