import { useState, useCallback, useEffect } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Animated, Platform } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition'
import { evaluateReading } from '../../lib/levenshtein'
import { api } from '../../lib/api'
import { colors, spacing, radius, typography } from '../../theme'

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = 'idle' | 'listening' | 'result'

interface EvalResult {
  transcript: string
  normalizedTranscript: string
  normalizedExpected: string
  distance: number
  passed: boolean
}

interface Props {
  kanjiId: number
  character: string
  /** Expected reading — kun or on yomi, e.g. 'みず' or 'すい' */
  expectedReading: string
  readingLabel?: string
  onResult?: (result: EvalResult) => void
}

// ─── Voice Evaluator ──────────────────────────────────────────────────────────

export function VoiceEvaluator({
  kanjiId,
  character,
  expectedReading,
  readingLabel = 'reading',
  onResult,
}: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<EvalResult | null>(null)
  const [transcript, setTranscript] = useState('')
  const [permissionGranted, setPermissionGranted] = useState(false)
  const [pulseAnim] = useState(new Animated.Value(1))

  // ── Permissions ────────────────────────────────────────────────────────────

  useEffect(() => {
    ExpoSpeechRecognitionModule.requestPermissionsAsync().then(({ granted }) => {
      setPermissionGranted(granted)
    })
  }, [])

  // ── Pulse animation while listening ───────────────────────────────────────

  useEffect(() => {
    if (phase === 'listening') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      ).start()
    } else {
      pulseAnim.setValue(1)
    }
  }, [phase])

  // ── Speech recognition events ─────────────────────────────────────────────

  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results?.[0]?.transcript ?? ''
    setTranscript(text)
  })

  useSpeechRecognitionEvent('end', async () => {
    if (!transcript) {
      setPhase('idle')
      return
    }

    const eval_ = evaluateReading(transcript, expectedReading)
    setResult(eval_)
    setPhase('result')

    Haptics.notificationAsync(
      eval_.passed
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Error
    )

    // Log to API (non-blocking)
    try {
      await api.post('/v1/review/voice', {
        kanjiId,
        transcript,
        expected: expectedReading,
        distance: eval_.distance,
        passed: eval_.passed,
      })
    } catch {
      // non-blocking
    }

    onResult?.(eval_)
  })

  useSpeechRecognitionEvent('error', () => {
    setPhase('idle')
  })

  // ── Start / Stop ──────────────────────────────────────────────────────────

  const startListening = useCallback(async () => {
    if (!permissionGranted) {
      const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync()
      if (!granted) return
      setPermissionGranted(true)
    }

    setTranscript('')
    setResult(null)
    setPhase('listening')
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    ExpoSpeechRecognitionModule.start({
      lang: 'ja-JP',
      interimResults: true,
      maxAlternatives: 1,
    })
  }, [permissionGranted])

  const stopListening = useCallback(() => {
    ExpoSpeechRecognitionModule.stop()
    setPhase('idle')
  }, [])

  const retry = useCallback(() => {
    setResult(null)
    setPhase('idle')
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Kanji + prompt */}
      <View style={styles.prompt}>
        <Text style={styles.character}>{character}</Text>
        <Text style={styles.promptLabel}>Say the {readingLabel}</Text>
        <Text style={styles.expectedHint}>({expectedReading})</Text>
      </View>

      {/* Mic button */}
      {phase !== 'result' && (
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <TouchableOpacity
            style={[styles.micBtn, phase === 'listening' && styles.micBtnActive]}
            onPress={phase === 'listening' ? stopListening : startListening}
            activeOpacity={0.8}
          >
            <Ionicons
              name={phase === 'listening' ? 'stop' : 'mic'}
              size={32}
              color="#fff"
            />
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Listening indicator */}
      {phase === 'listening' && (
        <View style={styles.listeningRow}>
          <View style={styles.listeningDot} />
          <Text style={styles.listeningText}>
            {transcript || 'Listening…'}
          </Text>
        </View>
      )}

      {/* Result */}
      {phase === 'result' && result && (
        <View style={styles.resultCard}>
          <View style={styles.resultHeader}>
            <Ionicons
              name={result.passed ? 'checkmark-circle' : 'close-circle'}
              size={28}
              color={result.passed ? colors.success : colors.error}
            />
            <Text style={[styles.resultTitle, { color: result.passed ? colors.success : colors.error }]}>
              {result.passed ? 'Correct!' : 'Not quite'}
            </Text>
          </View>

          <View style={styles.comparison}>
            <ComparisonRow label="You said" value={result.normalizedTranscript} />
            <ComparisonRow label="Expected" value={result.normalizedExpected} isExpected />
            <ComparisonRow label="Distance" value={`${result.distance} edit${result.distance !== 1 ? 's' : ''}`} />
          </View>

          <TouchableOpacity style={styles.retryBtn} onPress={retry}>
            <Ionicons name="refresh" size={16} color={colors.accent} />
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      )}

      {!permissionGranted && phase === 'idle' && (
        <Text style={styles.permissionWarning}>
          Microphone permission required for voice evaluation
        </Text>
      )}
    </View>
  )
}

// ─── Sub-component ────────────────────────────────────────────────────────────

function ComparisonRow({ label, value, isExpected }: { label: string; value: string; isExpected?: boolean }) {
  return (
    <View style={cmpStyles.row}>
      <Text style={cmpStyles.label}>{label}</Text>
      <Text style={[cmpStyles.value, isExpected && cmpStyles.expectedValue]}>{value}</Text>
    </View>
  )
}

const cmpStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { ...typography.bodySmall, color: colors.textMuted },
  value: { ...typography.body, color: colors.textPrimary },
  expectedValue: { color: colors.success },
})

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: spacing.lg },
  prompt: { alignItems: 'center', gap: 4 },
  character: { ...typography.kanjiLarge, color: colors.textPrimary },
  promptLabel: { ...typography.body, color: colors.textSecondary },
  expectedHint: { ...typography.reading, color: colors.textMuted },
  micBtn: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  micBtnActive: { backgroundColor: colors.error },
  listeningRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.bgCard, paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm, borderRadius: radius.full,
  },
  listeningDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error },
  listeningText: { ...typography.bodySmall, color: colors.textSecondary, maxWidth: 240 },
  resultCard: {
    width: '100%', backgroundColor: colors.bgCard, borderRadius: radius.lg,
    padding: spacing.md, gap: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  resultTitle: { ...typography.h3 },
  comparison: { gap: spacing.sm },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: spacing.sm,
  },
  retryText: { ...typography.bodySmall, color: colors.accent },
  permissionWarning: { ...typography.caption, color: colors.warning, textAlign: 'center' },
})
