import React from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import type { SessionBody, SessionCommitment } from '../../lib/buddy-session-state'
import { colors, radius, spacing, typography } from '../../theme'

// Every Text in this file carries an explicit colour.
//
// B146, found on device: this component had no styling at all. React Native
// defaults <Text> to black and colors.bg is #0F0F1A, so the screen rendered
// correctly and was entirely invisible — indistinguishable from a blank dead
// end, and inescapable because the route sets headerShown: false.
//
// The seven component tests passed throughout, because getByText finds text
// whatever colour it is. Colour is now asserted explicitly in the test file.

export function BuddySessionBody({
  body,
  onCommit,
  onClose,
}: {
  body: SessionBody
  onCommit: (c: SessionCommitment) => void
  onClose?: () => void
}) {
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Buddy</Text>
        <Pressable
          testID="buddy-session-close"
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={24} color={colors.textSecondary} />
        </Pressable>
      </View>
      {renderBody(body, onCommit)}
    </View>
  )
}

function renderBody(body: SessionBody, onCommit: (c: SessionCommitment) => void) {
  switch (body.kind) {
    case 'loading':
      return (
        <View testID="buddy-session-loading" style={styles.centred}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )
    case 'error':
      return (
        <View testID="buddy-session-error" style={styles.centred}>
          <Text style={styles.message}>Couldn't reach Buddy just now. Your week is still set.</Text>
        </View>
      )
    case 'not_scheduled':
      return (
        <View testID="buddy-session-not-scheduled" style={styles.centred}>
          <Text style={styles.message}>
            No weekly catch-up scheduled. Pick a day in Profile and we'll start.
          </Text>
        </View>
      )
    case 'waiting':
      return (
        <View testID="buddy-session-waiting" style={styles.centred}>
          <Text style={styles.message}>Next catch-up: {body.nextDue}</Text>
        </View>
      )
    case 'cards':
      return (
        <View testID="buddy-session-cards" style={styles.cards}>
          {body.cards.map((card, i) => {
            if (card.kind === 'set') {
              return (
                <View key={i} testID="buddy-session-set" style={styles.card}>
                  <Text style={styles.cardLabel}>The week ahead</Text>
                  <Text style={styles.commitment}>
                    {card.proposed.daysCommitted} days, {card.proposed.minutesPerDay} minutes
                  </Text>
                  <Pressable
                    testID="buddy-session-confirm"
                    style={styles.confirm}
                    accessibilityRole="button"
                    onPress={() => onCommit({ ...card.proposed, source: 'session' })}
                  >
                    <Text style={styles.confirmText}>That works</Text>
                  </Pressable>
                </View>
              )
            }
            return (
              <Text key={i} style={styles.prose}>
                {card.text}
              </Text>
            )
          })}
        </View>
      )
  }
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  headerTitle: { ...typography.h2, color: colors.textPrimary },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  message: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  cards: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.md },
  prose: { ...typography.body, color: colors.textPrimary, lineHeight: 24 },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardLabel: { ...typography.caption, color: colors.textMuted, textTransform: 'uppercase' },
  commitment: { ...typography.h3, color: colors.textPrimary },
  confirm: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  confirmText: { ...typography.body, color: '#FFFFFF', fontWeight: '600' },
})
