import { View, Text, StyleSheet } from 'react-native'
import { colors, spacing, radius, typography } from '../../theme'
import { TOTAL_JOUYOU_KANJI } from '@kanji-learn/shared'

interface StatusCounts {
  unseen: number
  learning: number
  reviewing: number
  remembered: number
  burned: number
}

interface Props {
  counts: StatusCounts
}

const SEGMENTS = [
  { key: 'burned' as const, color: colors.burned, label: 'Burned' },
  { key: 'remembered' as const, color: colors.remembered, label: 'Remembered' },
  { key: 'reviewing' as const, color: colors.reviewing, label: 'Reviewing' },
  { key: 'learning' as const, color: colors.learning, label: 'Learning' },
  { key: 'unseen' as const, color: colors.unseen, label: 'Unseen' },
]

export function SrsStatusBar({ counts }: Props) {
  const total = TOTAL_JOUYOU_KANJI

  return (
    <View style={styles.container}>
      {/* Stacked bar */}
      <View style={styles.bar}>
        {SEGMENTS.map(({ key, color }) => {
          const pct = (counts[key] / total) * 100
          if (pct < 0.5) return null
          return (
            <View key={key} style={[styles.segment, { flex: counts[key], backgroundColor: color }]} />
          )
        })}
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        {SEGMENTS.filter(({ key }) => counts[key] > 0).map(({ key, color, label }) => (
          <View key={key} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: color }]} />
            <Text style={styles.legendLabel}>{label}</Text>
            <Text style={styles.legendCount}>{counts[key].toLocaleString()}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  bar: {
    flexDirection: 'row',
    height: 12,
    borderRadius: radius.full,
    overflow: 'hidden',
    backgroundColor: colors.bgSurface,
  },
  segment: { height: '100%' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { ...typography.caption, color: colors.textSecondary },
  legendCount: { ...typography.caption, color: colors.textMuted },
})
