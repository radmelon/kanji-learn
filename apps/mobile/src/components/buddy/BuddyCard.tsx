// apps/mobile/src/components/buddy/BuddyCard.tsx
//
// Single nudge row. Neutral-soft visual treatment per Phase 1' design §4.3
// — matches InviteMateBanner aesthetic so Buddy reads as part of the
// dashboard banner vocabulary. Phase 5 re-skins once persona work happens.

import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, spacing, radius, typography } from '../../theme'
import type { BuddyNudge } from '@kanji-learn/shared'

interface BuddyCardProps {
  nudge: BuddyNudge
  onDismiss: () => void
}

export function BuddyCard({ nudge, onDismiss }: BuddyCardProps) {
  return (
    <View
      style={styles.container}
      accessibilityRole="text"
      accessibilityLabel={`Buddy says: ${nudge.content}`}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarEmoji}>🐵</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.content}>{nudge.content}</Text>
      </View>
      <TouchableOpacity
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss Buddy message"
        hitSlop={12}
        style={styles.dismiss}
      >
        <Ionicons name="close" size={18} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.bgSurface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  avatarEmoji: {
    fontSize: 18,
  },
  body: {
    flex: 1,
  },
  content: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    lineHeight: 18,
  },
  dismiss: { padding: spacing.xs },
})
