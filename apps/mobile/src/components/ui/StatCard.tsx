import { View, Text, StyleSheet } from 'react-native'
import { colors, spacing, radius, typography } from '../../theme'

interface Props {
  label: string
  value: string | number
  subtitle?: string
  accentColor?: string
}

export function StatCard({ label, value, subtitle, accentColor = colors.primary }: Props) {
  return (
    <View style={styles.card}>
      <Text style={[styles.value, { color: accentColor }]}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    gap: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  value: { ...typography.h1, fontWeight: '700' },
  label: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
  subtitle: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
})
