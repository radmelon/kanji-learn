import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
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
  { key: 'burned' as const, color: colors.burned, label: 'Mastered' },
  { key: 'remembered' as const, color: colors.remembered, label: 'Remembered' },
  { key: 'reviewing' as const, color: colors.reviewing, label: 'Reviewing' },
  { key: 'learning' as const, color: colors.learning, label: 'Learning' },
  { key: 'unseen' as const, color: colors.unseen, label: 'Unseen' },
]

// Each stage represents a band of SRS (Spaced Repetition System) review intervals.
// The SRS is based on the SM-2 algorithm developed by Piotr Woźniak (SuperMemo, 1987),
// which expands review intervals each time you answer correctly, letting well-known
// cards drift to months-long gaps while keeping difficult ones in frequent rotation.
const SEGMENT_DESCRIPTIONS: Record<string, string> = {
  learning: 'Interval < 7 days. New or recently failed cards — still building the initial memory trace. The SRS will increase the gap each time you answer correctly.',
  reviewing: '7–20 day interval. Memory is forming; you\'ve answered correctly several times and the SRS has stretched the interval to weeks.',
  remembered: '21–179 day interval. Solid long-term memory. The SRS schedules these infrequently — your brain can hold them without constant reinforcement.',
  burned: '≥ 180 day interval (~6 months). Considered mastered. The SRS has confirmed you can recall this kanji from genuine long-term memory. Still surfaces occasionally as a surprise check to make sure nothing has faded.',
  unseen: 'Not yet studied. Will be introduced gradually during daily sessions so your review queue never grows faster than you can handle.',
}

export function SrsStatusBar({ counts }: Props) {
  const [expanded, setExpanded] = useState(false)
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

      {/* Legend row with expand toggle */}
      <TouchableOpacity
        style={styles.legendRow}
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.7}
      >
        <View style={styles.legend}>
          {SEGMENTS.filter(({ key }) => counts[key] > 0).map(({ key, color, label }) => (
            <View key={key} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: color }]} />
              <Text style={styles.legendLabel}>{label}</Text>
              <Text style={styles.legendCount}>{counts[key].toLocaleString()}</Text>
            </View>
          ))}
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'information-circle-outline'}
          size={16}
          color={colors.textMuted}
        />
      </TouchableOpacity>

      {/* Expandable descriptions */}
      {expanded && (
        <View style={styles.descriptions}>
          {SEGMENTS.map(({ key, color, label }) => (
            <View key={key} style={styles.descRow}>
              <View style={[styles.descDot, { backgroundColor: color }]} />
              <View style={styles.descTextCol}>
                <Text style={[styles.descLabel, { color }]}>{label}</Text>
                <Text style={styles.descText}>{SEGMENT_DESCRIPTIONS[key]}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
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
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, flex: 1 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { ...typography.caption, color: colors.textSecondary },
  legendCount: { ...typography.caption, color: colors.textMuted },

  // Expandable
  descriptions: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  descRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  descDot: { width: 10, height: 10, borderRadius: 5, marginTop: 3 },
  descTextCol: { flex: 1, gap: 2 },
  descLabel: { ...typography.bodySmall, fontWeight: '700' },
  descText: { ...typography.caption, color: colors.textSecondary, lineHeight: 18 },
})
