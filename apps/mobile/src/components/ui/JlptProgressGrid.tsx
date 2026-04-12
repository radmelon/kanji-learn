import { View, Text, StyleSheet } from 'react-native'
import { colors, spacing, radius, typography } from '../../theme'
import { JLPT_LEVELS, JLPT_KANJI_COUNTS } from '@kanji-learn/shared'

export interface JlptBreakdown {
  learning: number
  reviewing: number
  remembered: number
  burned: number
}

interface Props {
  jlptProgress: Record<string, JlptBreakdown | number>
}

export function JlptProgressGrid({ jlptProgress }: Props) {
  return (
    <View style={styles.grid}>
      {JLPT_LEVELS.map((level) => {
        const levelTotal = JLPT_KANJI_COUNTS[level]
        const raw = jlptProgress[level]
        const bd: JlptBreakdown =
          typeof raw === 'number'
            ? { learning: 0, reviewing: 0, remembered: 0, burned: raw }
            : raw ?? { learning: 0, reviewing: 0, remembered: 0, burned: 0 }
        const total = bd.learning + bd.reviewing + bd.remembered + bd.burned
        return (
          <View key={level} style={styles.row}>
            <Text style={styles.level}>{level}</Text>
            <View style={styles.track}>
              {bd.learning > 0 && (
                <View
                  style={[
                    styles.seg,
                    { width: `${(bd.learning / levelTotal) * 100}%`, backgroundColor: colors.learning },
                  ]}
                />
              )}
              {bd.reviewing > 0 && (
                <View
                  style={[
                    styles.seg,
                    { width: `${(bd.reviewing / levelTotal) * 100}%`, backgroundColor: colors.reviewing },
                  ]}
                />
              )}
              {bd.remembered > 0 && (
                <View
                  style={[
                    styles.seg,
                    { width: `${(bd.remembered / levelTotal) * 100}%`, backgroundColor: colors.remembered },
                  ]}
                />
              )}
              {bd.burned > 0 && (
                <View
                  style={[
                    styles.seg,
                    { width: `${(bd.burned / levelTotal) * 100}%`, backgroundColor: colors.burned },
                  ]}
                />
              )}
            </View>
            <Text style={styles.count}>
              {total}/{levelTotal}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  grid: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  level: { ...typography.caption, color: colors.textMuted, width: 24, fontWeight: '700' },
  track: {
    flex: 1,
    height: 6,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.full,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  seg: { height: '100%' },
  count: { ...typography.caption, color: colors.textMuted, width: 64, textAlign: 'right' },
})
