import { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { storage } from '../../lib/storage'
import { colors, spacing, radius, typography } from '../../theme'

const STORAGE_KEY = 'kl:invite_mate_dismissed_at'
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

interface Props {
  onInvite: () => void
  mateCount: number
}

export function InviteMateBanner({ onInvite, mateCount }: Props) {
  const [hidden, setHidden] = useState<boolean>(true)

  useEffect(() => {
    let cancelled = false
    async function check() {
      if (mateCount > 0) {
        setHidden(true)
        return
      }
      const dismissedAt = await storage.getItem<number>(STORAGE_KEY)
      const stillCooling = dismissedAt && Date.now() - dismissedAt < COOLDOWN_MS
      if (!cancelled) setHidden(!!stillCooling)
    }
    check()
    return () => { cancelled = true }
  }, [mateCount])

  const handleDismiss = async () => {
    await storage.setItem(STORAGE_KEY, Date.now())
    setHidden(true)
  }

  if (hidden) return null

  return (
    <TouchableOpacity style={styles.banner} onPress={onInvite} activeOpacity={0.85}>
      <Ionicons name="people" size={20} color={colors.primary} style={styles.icon} />
      <View style={styles.textWrap}>
        <Text style={styles.title}>Study with a friend</Text>
        <Text style={styles.subtitle}>Invite a study mate to compare progress and stay motivated.</Text>
      </View>
      <TouchableOpacity onPress={handleDismiss} hitSlop={12} style={styles.dismiss}>
        <Ionicons name="close" size={18} color={colors.textMuted} />
      </TouchableOpacity>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSurface,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  icon: { marginLeft: spacing.xs },
  textWrap: { flex: 1, gap: 2 },
  title: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  subtitle: { ...typography.caption, color: colors.textMuted },
  dismiss: { padding: spacing.xs },
})
