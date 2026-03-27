import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, spacing, radius, typography } from '../../theme'
import type { Intervention } from '../../hooks/useInterventions'

interface Props {
  intervention: Intervention
  onDismiss: () => void
}

const ICON_MAP = {
  absence: 'time-outline',
  velocity_drop: 'trending-down-outline',
  plateau: 'analytics-outline',
} as const

export function InterventionBanner({ intervention, onDismiss }: Props) {
  return (
    <View style={styles.banner}>
      <Ionicons
        name={ICON_MAP[intervention.type]}
        size={20}
        color={colors.warning}
        style={styles.icon}
      />
      <Text style={styles.message} numberOfLines={3}>
        {intervention.message}
      </Text>
      <TouchableOpacity onPress={onDismiss} style={styles.dismiss}>
        <Ionicons name="close" size={18} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
    padding: spacing.md,
    gap: spacing.sm,
  },
  icon: { marginTop: 1 },
  message: { ...typography.bodySmall, color: colors.textPrimary, flex: 1, lineHeight: 20 },
  dismiss: { padding: 2 },
})
