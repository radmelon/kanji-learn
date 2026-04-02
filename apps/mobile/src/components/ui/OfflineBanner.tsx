import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, spacing, radius, typography } from '../../theme'

interface Props {
  message?: string
  staleLabel?: string
}

export function OfflineBanner({ message = 'You\'re offline', staleLabel }: Props) {
  return (
    <View style={styles.banner}>
      <Ionicons name="cloud-offline-outline" size={14} color={colors.warning} />
      <Text style={styles.text}>{message}</Text>
      {staleLabel && <Text style={styles.stale}>{staleLabel}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.warning + '22',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.warning + '44',
  },
  text: { ...typography.caption, color: colors.warning, flex: 1 },
  stale: { ...typography.caption, color: colors.warning, opacity: 0.7 },
})
