import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { MeetingBody } from '../src/components/meeting/MeetingBody'
import { selectMeetingScreen } from '../src/lib/meeting-screen-state'
import { useMeetBuddyStore } from '../src/stores/meet-buddy.store'
import { markMetBuddyLocally } from '../src/hooks/useProfile'
import { colors, radius, spacing, typography } from '../src/theme'

export default function OnboardingScreen() {
  const { ui, begin, sendText, answer, finish, skip } = useMeetBuddyStore()
  // F3 (whole-branch review, HIGH): Profile's "Meet Buddy" row pushes here
  // with ?revisit=1 so a learner who has already met Buddy can come back —
  // begin() otherwise bails 'already_done' for everyone who can see that row.
  const { revisit } = useLocalSearchParams<{ revisit?: string }>()
  // F4(a) (whole-branch review, HIGH): begin() returns 'pending_offline' when
  // a prior offline completion is still stuck in the local queue — a flush
  // was just attempted and failed. Bouncing to tabs here would be silent AND
  // would loop straight back: _layout.tsx's gate checks profile.metBuddyAt,
  // which a failed flush never touched.
  const [pendingOffline, setPendingOffline] = useState(false)
  // B147, found on device: `if (!ui) return <SafeAreaView />` rendered an EMPTY
  // view for the whole of begin()'s round-trip, and forever when the request
  // hung. These two flags let selectMeetingScreen tell "still working" apart
  // from "finished with nothing to show" — the distinction the blank view
  // erased. See src/lib/meeting-screen-state.ts.
  const [settled, setSettled] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const attemptBegin = useCallback(() => {
    setPendingOffline(false)
    setSettled(false)
    setLeaving(false)
    void begin({ revisit: revisit === '1' })
      .then((state) => {
        if (state === 'already_done') {
          setLeaving(true)
          router.replace('/(tabs)')
        } else if (state === 'pending_offline') setPendingOffline(true)
      })
      // begin() resolves rather than throwing today, but a future throw must
      // not strand the screen on a spinner forever — the failure this whole
      // file exists to stop.
      .finally(() => setSettled(true))
  }, [begin, revisit])

  useEffect(() => {
    attemptBegin()
    // Only re-run when the inputs to begin() change — attemptBegin's own
    // identity already depends on both, so this mirrors the prior effect's
    // [begin, revisit] deps exactly.
  }, [attemptBegin])

  const screen = selectMeetingScreen({ settled, hasUi: ui !== null, pendingOffline, leaving })

  if (screen.kind === 'loading') {
    return (
      <SafeAreaView style={styles.root}>
        <View testID="meeting-loading" style={styles.centred}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    )
  }

  if (screen.kind === 'error') {
    return (
      <SafeAreaView style={styles.root}>
        <View testID="meeting-error" style={styles.pendingWrap}>
          <Text style={styles.pendingText}>
            We couldn't start your meeting with Buddy just now. Check your
            connection and try again.
          </Text>
          <Pressable
            testID="meeting-error-retry"
            onPress={attemptBegin}
            accessibilityRole="button"
            accessibilityLabel="Retry"
            style={styles.pendingPrimaryButton}
          >
            <Text style={styles.pendingPrimaryButtonText}>Retry</Text>
          </Pressable>
          <Pressable
            testID="meeting-error-skip"
            onPress={() => router.replace('/onboarding-form')}
            accessibilityRole="button"
            accessibilityLabel="Use the form instead"
            style={styles.pendingSecondaryButton}
          >
            <Text style={styles.pendingSecondaryButtonText}>Use the form instead</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  if (screen.kind === 'pending_offline') {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.pendingWrap}>
          <Text style={styles.pendingText}>
            We couldn't finish saving your last meeting with Buddy — it looks
            like you're still offline. We'll keep this queued and try again.
          </Text>
          <Pressable
            testID="pending-offline-retry"
            onPress={attemptBegin}
            accessibilityRole="button"
            accessibilityLabel="Retry"
            style={styles.pendingPrimaryButton}
          >
            <Text style={styles.pendingPrimaryButtonText}>Retry</Text>
          </Pressable>
          <Pressable
            testID="pending-offline-continue"
            onPress={() => {
              markMetBuddyLocally()
              router.replace('/(tabs)')
            }}
            accessibilityRole="button"
            accessibilityLabel="Continue anyway"
            style={styles.pendingSecondaryButton}
          >
            <Text style={styles.pendingSecondaryButtonText}>Continue anyway</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root}>
      <MeetingBody
        ui={ui!}
        onAnswer={answer}
        onSendText={(t) => void sendText(t)}
        onFinish={(dest) => {
          void finish().finally(() =>
            router.replace(dest === 'placement' ? '/placement' : '/(tabs)'),
          )
        }}
        onSkipToForm={() => router.replace('/onboarding-form')}
        onSkipOutright={() => {
          void skip().finally(() => router.replace('/(tabs)'))
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pendingWrap: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  pendingText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  pendingPrimaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  pendingPrimaryButtonText: { ...typography.h3, color: colors.textPrimary },
  pendingSecondaryButton: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  pendingSecondaryButtonText: { ...typography.body, color: colors.textSecondary },
})
