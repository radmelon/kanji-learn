// apps/mobile/src/components/buddy/BuddyCardStack.tsx
//
// Per-screen wrapper. Calls useBuddyNudges, renders 0-2 BuddyCard rows
// in priority-descending order, handles dismissal. Returns null when
// the array is empty so an empty stack contributes zero visual space.

import React from 'react'
import { StyleSheet, View } from 'react-native'
import { BuddyCard } from './BuddyCard'
import { useBuddyNudges } from '../../hooks/useBuddyNudges'
import type { BuddyScreen } from '@kanji-learn/shared'

interface BuddyCardStackProps {
  screen: BuddyScreen
}

export function BuddyCardStack({ screen }: BuddyCardStackProps) {
  const { nudges, dismiss } = useBuddyNudges(screen)

  if (nudges.length === 0) return null

  return (
    <View style={styles.stack}>
      {nudges.slice(0, 2).map((nudge) => (
        <BuddyCard key={nudge.id} nudge={nudge} onDismiss={() => dismiss(nudge.id)} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  stack: {
    gap: 8,
    marginVertical: 8,
  },
})
