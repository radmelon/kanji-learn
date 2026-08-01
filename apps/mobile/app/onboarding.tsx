import React, { useEffect } from 'react'
import { SafeAreaView, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { MeetingBody } from '../src/components/meeting/MeetingBody'
import { useMeetBuddyStore } from '../src/stores/meet-buddy.store'
import { colors } from '../src/theme'

export default function OnboardingScreen() {
  const { ui, begin, sendText, answer, finish, skip } = useMeetBuddyStore()

  useEffect(() => {
    void begin().then((state) => {
      if (state === 'already_done') router.replace('/(tabs)')
    })
  }, [begin])

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
