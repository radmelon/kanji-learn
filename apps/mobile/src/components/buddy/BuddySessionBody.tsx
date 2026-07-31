import React from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import type { SessionBody, SessionCommitment } from '../../lib/buddy-session-state'

export function BuddySessionBody({
  body,
  onCommit,
}: {
  body: SessionBody
  onCommit: (c: SessionCommitment) => void
}) {
  switch (body.kind) {
    case 'loading':
      return (
        <View testID="buddy-session-loading">
          <ActivityIndicator />
        </View>
      )
    case 'error':
      return (
        <View testID="buddy-session-error">
          <Text>Couldn't reach Buddy just now. Your week is still set.</Text>
        </View>
      )
    case 'not_scheduled':
      return (
        <View testID="buddy-session-not-scheduled">
          <Text>No weekly catch-up scheduled. Pick a day in Profile and we'll start.</Text>
        </View>
      )
    case 'waiting':
      return (
        <View testID="buddy-session-waiting">
          <Text>Next catch-up: {body.nextDue}</Text>
        </View>
      )
    case 'cards':
      return (
        <View testID="buddy-session-cards">
          {body.cards.map((card, i) => {
            if (card.kind === 'set') {
              return (
                <View key={i} testID="buddy-session-set">
                  <Text>
                    {card.proposed.daysCommitted} days, {card.proposed.minutesPerDay} minutes
                  </Text>
                  <Pressable
                    testID="buddy-session-confirm"
                    onPress={() => onCommit({ ...card.proposed, source: 'session' })}
                  >
                    <Text>That works</Text>
                  </Pressable>
                </View>
              )
            }
            return <Text key={i}>{card.text}</Text>
          })}
        </View>
      )
  }
}
