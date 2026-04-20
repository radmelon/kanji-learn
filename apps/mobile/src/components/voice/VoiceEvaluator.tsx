import { useState, useCallback, useEffect, useRef } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { api } from '../../lib/api'
import { colors, spacing, radius, typography } from '../../theme'
import { PitchAccentReading } from '../kanji/PitchAccentReading'
import { useShowPitchAccent } from '../../hooks/useShowPitchAccent'
import type { VoicePrompt } from '@kanji-learn/shared'

// ─── Safe native module loading ───────────────────────────────────────────────
// expo-speech-recognition calls requireNativeModule at import time, which
// throws in Expo Go. We use require() inside a try/catch so the rest of the
// app keeps working, and surface a dev-build prompt instead.

type SpeechMod = typeof import('expo-speech-recognition')

let _mod: SpeechMod | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  _mod = require('expo-speech-recognition') as SpeechMod
} catch {
  _mod = null
}

const SPEECH_AVAILABLE = _mod !== null

// Always-callable stubs — React rules require hooks to be called on every
// render regardless of availability. When _mod is null these are no-ops.
const _useSpeechRecognitionEvent: SpeechMod['useSpeechRecognitionEvent'] =
  _mod?.useSpeechRecognitionEvent ?? (() => {}) as SpeechMod['useSpeechRecognitionEvent']

const _SpeechRecognitionModule = _mod?.ExpoSpeechRecognitionModule ?? null

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = 'idle' | 'listening' | 'evaluating' | 'result'

interface EvalResult {
  correct:         boolean
  quality:         number   // SM-2 0–5
  feedback:        string
  normalizedSpoken: string
  closestCorrect:  string
}

interface Props {
  kanjiId: number
  character: string
  /** All accepted readings in hiragana, e.g. ['みず'] or ['すい','みず']
   *  Used when voicePrompt is absent or of type 'kanji'. When voicePrompt
   *  is of type 'vocab', only [voicePrompt.reading] is sent to the server. */
  correctReadings: string[]
  /** Label shown in the prompt, e.g. 'kun'yomi' or 'reading' */
  readingLabel?: string
  /** Called when server returns an evaluation result */
  onResult?: (result: EvalResult) => void
  /** Whether to use strict mode (no near-matches) — for checkpoint tests */
  strict?: boolean
  /** Hide the expected reading hint below the prompt (for Prompted/Recall/Challenge difficulty) */
  hideHint?: boolean
  /** Attached by the API to each reading-queue item. When present and of
   *  type 'vocab', the evaluator renders a vocab-word layout (glyph =
   *  vocab.word, pitch overlay, meaning line). Fallback to kanji layout
   *  when absent or of type 'kanji'. */
  voicePrompt?: VoicePrompt
}

// ─── Voice Evaluator ──────────────────────────────────────────────────────────

export function VoiceEvaluator({
  kanjiId,
  character,
  correctReadings,
  readingLabel = 'reading',
  onResult,
  strict = false,
  hideHint = false,
  voicePrompt,
}: Props) {
  const [showPitchAccent] = useShowPitchAccent()
  const isVocabMode = voicePrompt?.type === 'vocab'
  // When the API attached a vocab prompt, send only that reading to the
  // evaluator — the target is a specific vocab word, not "any reading of
  // this kanji". Keeps feedback aligned with what the user was shown.
  const effectiveCorrectReadings = isVocabMode ? [voicePrompt.reading] : correctReadings

  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<EvalResult | null>(null)
  const [transcript, setTranscript] = useState('')
  const transcriptRef = useRef('')          // always-current mirror of transcript state
  const [permissionGranted, setPermissionGranted] = useState(false)
  const [pulseAnim] = useState(new Animated.Value(1))

  // ── Permissions (skipped when module is unavailable) ───────────────────────

  useEffect(() => {
    if (!_SpeechRecognitionModule) return
    _SpeechRecognitionModule.requestPermissionsAsync().then(({ granted }) => {
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
  // These hooks MUST be called unconditionally. When _mod is null they are
  // no-ops, so they satisfy React's rules-of-hooks without crashing.

  _useSpeechRecognitionEvent('result', (event) => {
    const text = event.results?.[0]?.transcript ?? ''
    transcriptRef.current = text
    setTranscript(text)
  })

  _useSpeechRecognitionEvent('end', async () => {
    const currentTranscript = transcriptRef.current
    if (!currentTranscript) {
      setPhase('idle')
      return
    }

    // Show spinner while server evaluates
    setPhase('evaluating')

    try {
      const eval_ = await api.post<EvalResult>('/v1/review/voice', {
        kanjiId,
        transcript: currentTranscript,
        correctReadings: effectiveCorrectReadings,
        strict,
      })
      setResult(eval_)
      setPhase('result')

      Haptics.notificationAsync(
        eval_.correct
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Error
      )

      onResult?.(eval_)
    } catch {
      // Network error — fall back to idle so user can retry
      setPhase('idle')
    }
  })

  _useSpeechRecognitionEvent('error', () => {
    setPhase('idle')
  })

  // ── Start / Stop ──────────────────────────────────────────────────────────

  const startListening = useCallback(async () => {
    if (!_SpeechRecognitionModule) return

    if (!permissionGranted) {
      const { granted } = await _SpeechRecognitionModule.requestPermissionsAsync()
      if (!granted) return
      setPermissionGranted(true)
    }

    setTranscript('')
    transcriptRef.current = ''
    setResult(null)
    setPhase('listening')
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    _SpeechRecognitionModule.start({
      lang: 'ja-JP',
      interimResults: true,
      maxAlternatives: 1,
    })
  }, [permissionGranted])

  const stopListening = useCallback(() => {
    _SpeechRecognitionModule?.stop()
    setPhase('idle')
  }, [])

  const retry = useCallback(() => {
    setResult(null)
    setPhase('idle')
  }, [])

  // ── Dev-build required banner ─────────────────────────────────────────────

  if (!SPEECH_AVAILABLE) {
    return (
      <View style={styles.unavailable}>
        <Ionicons name="construct-outline" size={40} color={colors.textMuted} />
        <Text style={styles.unavailableTitle}>Dev build required</Text>
        <Text style={styles.unavailableBody}>
          Voice evaluation uses a native speech module that isn't available in Expo Go.
          Run{' '}
          <Text style={styles.code}>npx expo run:ios</Text>
          {' '}or{' '}
          <Text style={styles.code}>npx expo run:android</Text>
          {' '}to build a local dev client.
        </Text>
        <View style={styles.characterPreview}>
          <Text style={styles.character}>{isVocabMode ? voicePrompt.word : character}</Text>
          <Text style={styles.expectedHint}>{effectiveCorrectReadings[0]}</Text>
        </View>
      </View>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Prompt — vocab layout when voicePrompt is present, else legacy kanji layout */}
      {isVocabMode ? (
        <View style={styles.prompt}>
          <Text style={styles.character}>{voicePrompt.word}</Text>
          <PitchAccentReading
            reading={voicePrompt.reading}
            pattern={voicePrompt.pitchPattern}
            enabled={showPitchAccent}
            size="large"
          />
          <Text style={styles.promptLabel}>Say this word</Text>
          {!hideHint && (
            <>
              <Text style={styles.expectedHint}>({voicePrompt.reading})</Text>
              <Text style={styles.meaningHint}>{voicePrompt.meaning}</Text>
            </>
          )}
        </View>
      ) : (
        <View style={styles.prompt}>
          <Text style={styles.character}>{character}</Text>
          <Text style={styles.promptLabel}>Say the {readingLabel}</Text>
          {!hideHint && <Text style={styles.expectedHint}>({correctReadings[0]})</Text>}
        </View>
      )}

      {/* Mic button — hidden while evaluating or showing result */}
      {phase !== 'result' && phase !== 'evaluating' && (
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

      {/* Evaluating spinner */}
      {phase === 'evaluating' && (
        <View style={styles.listeningRow}>
          <Text style={styles.listeningText}>Evaluating…</Text>
        </View>
      )}

      {/* Result */}
      {phase === 'result' && result && (
        <View style={styles.resultCard}>
          <View style={styles.resultHeader}>
            <Ionicons
              name={result.correct ? 'checkmark-circle' : 'close-circle'}
              size={28}
              color={result.correct ? colors.success : colors.error}
            />
            <Text style={[styles.resultTitle, { color: result.correct ? colors.success : colors.error }]}>
              {result.correct ? 'Correct!' : 'Not quite'}
            </Text>
          </View>

          <View style={styles.comparison}>
            <ComparisonRow label="You said"  value={result.normalizedSpoken} />
            <ComparisonRow label="Expected"  value={result.closestCorrect} isExpected />
            <ComparisonRow label="Feedback"  value={result.feedback} />
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

// ─── Sub-components ───────────────────────────────────────────────────────────

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
  meaningHint: { ...typography.bodySmall, color: colors.textMuted, fontStyle: 'italic' },
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

  // Dev-build unavailable state
  unavailable: {
    alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  unavailableTitle: { ...typography.h3, color: colors.textPrimary },
  unavailableBody: {
    ...typography.bodySmall, color: colors.textSecondary,
    textAlign: 'center', lineHeight: 20,
  },
  code: {
    fontFamily: 'Courier', color: colors.accent,
    backgroundColor: colors.bgSurface,
  },
  characterPreview: {
    alignItems: 'center', gap: 4,
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border,
    width: '100%',
  },
})
