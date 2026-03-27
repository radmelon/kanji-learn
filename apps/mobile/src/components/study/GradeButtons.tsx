import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import * as Haptics from 'expo-haptics'
import { colors, spacing, radius, typography } from '../../theme'

interface Props {
  onGrade: (quality: 0 | 1 | 2 | 3 | 4 | 5) => void
}

const GRADES = [
  { quality: 1 as const, label: 'Again', sublabel: 'Total blank', color: colors.error },
  { quality: 3 as const, label: 'Hard', sublabel: 'Struggled', color: colors.warning },
  { quality: 4 as const, label: 'Good', sublabel: 'Correct', color: colors.success },
  { quality: 5 as const, label: 'Easy', sublabel: 'Perfect', color: colors.accent },
]

export function GradeButtons({ onGrade }: Props) {
  const handlePress = (quality: 0 | 1 | 2 | 3 | 4 | 5) => {
    const style =
      quality <= 1
        ? Haptics.ImpactFeedbackStyle.Heavy
        : quality >= 4
        ? Haptics.ImpactFeedbackStyle.Light
        : Haptics.ImpactFeedbackStyle.Medium
    Haptics.impactAsync(style)
    onGrade(quality)
  }

  return (
    <View style={styles.container}>
      {GRADES.map(({ quality, label, sublabel, color }) => (
        <TouchableOpacity
          key={quality}
          style={[styles.button, { borderColor: color + '55' }]}
          onPress={() => handlePress(quality)}
          activeOpacity={0.75}
        >
          <View style={[styles.indicator, { backgroundColor: color }]} />
          <Text style={[styles.label, { color }]}>{label}</Text>
          <Text style={styles.sublabel}>{sublabel}</Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md },
  button: {
    flex: 1,
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    gap: 2,
  },
  indicator: { width: 24, height: 4, borderRadius: radius.full, marginBottom: 4 },
  label: { ...typography.bodySmall, fontWeight: '700' },
  sublabel: { ...typography.caption, color: colors.textMuted },
})
