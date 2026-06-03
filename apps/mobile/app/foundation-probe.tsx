// TEMPORARY on-device probe for Apple Foundation Models (Plan 3a Task 3).
// Route: /foundation-probe. Removed in Plan 3a Task 6 once the seam is verified.
import { useState } from 'react'
import { View, Text, Button, ScrollView, ActivityIndicator } from 'react-native'
import { AppleFoundationModels } from '@react-native-ai/apple'

export default function FoundationProbe() {
  const [out, setOut] = useState('(idle)')
  const [busy, setBusy] = useState(false)

  function checkAvailable() {
    try {
      setOut(`isAvailable() → ${String(AppleFoundationModels.isAvailable())}`)
    } catch (e) {
      setOut(`isAvailable threw: ${String(e)}`)
    }
  }

  async function generate() {
    setBusy(true)
    setOut('generating on-device…')
    try {
      const parts = await AppleFoundationModels.generateText(
        [
          { role: 'system', content: 'You greet Japanese learners warmly in one short sentence.' },
          { role: 'user', content: 'Greet a learner named Buddy.' },
        ],
        { maxTokens: 60 },
      )
      // Log the RAW result so we confirm the exact shape, then the extracted text.
      const text = parts.find((p) => p.type === 'text')?.text
      setOut(`RAW: ${JSON.stringify(parts)}\n\nTEXT: ${text ?? '(no text part)'}`)
    } catch (e) {
      setOut(`ERROR / UNAVAILABLE: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: '700' }}>Foundation Models probe</Text>
      <Button title="Check isAvailable()" onPress={checkAvailable} />
      <Button title="Generate one sentence (on-device)" onPress={generate} disabled={busy} />
      {busy ? <ActivityIndicator /> : null}
      <Text selectable style={{ fontFamily: 'Courier', fontSize: 13 }}>{out}</Text>
    </ScrollView>
  )
}
