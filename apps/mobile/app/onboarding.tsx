import React, { useEffect } from 'react'
import { SafeAreaView, StyleSheet } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { MeetingBody } from '../src/components/meeting/MeetingBody'
import { useMeetBuddyStore } from '../src/stores/meet-buddy.store'
import { colors } from '../src/theme'

export default function OnboardingScreen() {
  const { ui, begin, sendText, answer, finish, skip } = useMeetBuddyStore()
  // F3 (whole-branch review, HIGH): Profile's "Meet Buddy" row pushes here
  // with ?revisit=1 so a learner who has already met Buddy can come back —
  // begin() otherwise bails 'already_done' for everyone who can see that row.
  const { revisit } = useLocalSearchParams<{ revisit?: string }>()

  useEffect(() => {
    void begin({ revisit: revisit === '1' }).then((state) => {
      if (state === 'already_done') router.replace('/(tabs)')
    })
  }, [begin, revisit])

  if (!ui) return <SafeAreaView style={styles.root} />

  return (
    <SafeAreaView style={styles.root}>
      <MeetingBody
        ui={ui}
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

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.bg } })
