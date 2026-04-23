import { useState, useCallback, useEffect, useRef } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Animated, AccessibilityInfo } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { api } from '../../lib/api'
import { colors, spacing, radius, typography } from '../../theme'
import { PitchAccentReading } from '../kanji/PitchAccentReading'
import { useShowPitchAccent } from '../../hooks/useShowPitchAccent'
import type { VoicePrompt } from '@kanji-learn/shared'
import { TargetChip } from './TargetChip'
import { computeAttemptsCount, targetChipMask } from './voiceReveal.logic'

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

type Phase = 'idle' | 'listening' | 'evaluating'

export interface EvalResult {
  correct:         boolean
  quality:         number   // SM-2 0–5
  feedback:        string
  normalizedSpoken: string
  closestCorrect:  string
}

interface Props {
  kanjiId: number
  character: string
  correctReadings: string[]
  readingLabel?: string
  onResult?: (result: EvalResult) => void
  strict?: boolean
  voicePrompt?: VoicePrompt

  // ── Progressive-hints props (drive the 4-tier reveal ladder) ──
  attempts: number
  revealHiragana: boolean
  revealPitch: boolean
  revealVocabMeaning: boolean
}

// ─── Voice Evaluator ──────────────────────────────────────────────────────────

export function VoiceEvaluator({
  kanjiId,
  character,
  correctReadings,
  readingLabel = 'reading',
  onResult,
  strict = false,
  voicePrompt,
  attempts,
  revealHiragana,
  revealPitch,
  revealVocabMeaning,
}: Props) {
  const [showPitchAccent] = useShowPitchAccent()
  const isVocabMode = voicePrompt?.type === 'vocab'
  // When the API attached a vocab prompt, send only that reading to the
  // evaluator — the target is a specific vocab word, not "any reading of
  // this kanji". Keeps feedback aligned with what the user was shown.
  const effectiveCorrectReadings = isVocabMode ? [voicePrompt.reading] : correctReadings

  const [phase, setPhase] = useState<Phase>('idle')
  const [transcript, setTranscript] = useState('')
  const transcriptRef = useRef('')          // always-current mirror of transcript state
  const [permissionGranted, setPermissionGranted] = useState(false)
  const [pulseAnim] = useState(new Animated.Value(1))
  const [reduceMotion, setReduceMotion] = useState(false)

  // ── Permissions (skipped when module is unavailable) ───────────────────────

  useEffect(() => {
    if (!_SpeechRecognitionModule) return
    _SpeechRecognitionModule.requestPermissionsAsync().then(({ granted }) => {
      setPermissionGranted(granted)
    })
  }, [])

  // ── Reduce-motion accessibility preference ────────────────────────────────

  useEffect(() => {
    let cancelled = false
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (!cancelled) setReduceMotion(v)
    })
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => { cancelled = true; sub.remove() }
  }, [])

  // ── Pulse animation while listening ───────────────────────────────────────

  useEffect(() => {
    if (phase === 'listening') {
      if (!reduceMotion) {
        Animated.loop(
          Animated.sequence([
            Animated.timing(pulseAnim, { toValue: 1.15, duration: 600, useNativeDriver: true }),
            Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
          ])
        ).start()
      } else {
        // User toggled Reduce Motion on mid-session — stop the running pulse.
        pulseAnim.stopAnimation()
        pulseAnim.setValue(1)
      }
    } else {
      pulseAnim.setValue(1)
    }
  }, [phase, reduceMotion])

  // ── Core eval POST ────────────────────────────────────────────────────────
  // Extracted so the 'end' event handler AND the dev force-buttons share the
  // same POST + haptic + onResult plumbing without duplication.

  const submitEval = useCallback(async (spokenTranscript: string) => {
    setPhase('evaluating')
    try {
      const eval_ = await api.post<EvalResult>('/v1/review/voice', {
        kanjiId,
        transcript: spokenTranscript,
        correctReadings: effectiveCorrectReadings,
        strict,
        attemptsCount: computeAttemptsCount(attempts),
      })
      Haptics.notificationAsync(
        eval_.correct
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning
      )
      onResult?.(eval_)
      setPhase('idle')
    } catch (err) {
      // Dev-only log. Expo's default babel config does NOT strip console
      // calls, so we gate explicitly on __DEV__ to keep release bundles
      // quiet. The graceful idle-reset is preserved in both environments.
      if (__DEV__) {
        console.error('[VoiceEvaluator] submitEval failed', { transcript: spokenTranscript, err })
      }
      setPhase('idle')
    }
  }, [kanjiId, effectiveCorrectReadings, strict, attempts, onResult])

  // ── Dev-only simulator force-buttons ─────────────────────────────────────

  const forceWrong = useCallback(() => {
    void submitEval('xxxxxxxx')
  }, [submitEval])

  const forceCorrect = useCallback(() => {
    const expected = voicePrompt?.type === 'vocab'
      ? voicePrompt.reading
      : effectiveCorrectReadings[0]
    void submitEval(expected ?? '')
  }, [submitEval, voicePrompt, effectiveCorrectReadings])

  // ── Speech recognition events ─────────────────────────────────────────────
  // These hooks MUST be called unconditionally. When _mod is null they are
  // no-ops, so they satisfy React's rules-of-hooks without crashing.

  _useSpeechRecognitionEvent('result', (event) => {
    const text = event.results?.[0]?.transcript ?? ''
    transcriptRef.current = text
    setTranscript(text)
  })

  _useSpeechRecognitionEvent('end', () => {
    const currentTranscript = transcriptRef.current
    if (!currentTranscript) {
      setPhase('idle')
      return
    }
    void submitEval(currentTranscript)
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
          <Text style={styles.character}>
            {(() => {
              const tk = voicePrompt.targetKanji ?? character
              const mask = targetChipMask(voicePrompt.word, tk)
              return Array.from(voicePrompt.word).map((c, i) =>
                mask[i]
                  ? <TargetChip key={i}>{c}</TargetChip>
                  : <Text key={i}>{c}</Text>
              )
            })()}
          </Text>
          {revealHiragana && (
            <PitchAccentReading
              reading={voicePrompt.reading}
              pattern={voicePrompt.pitchPattern}
              enabled={showPitchAccent || revealPitch}
              size="large"
            />
          )}
          <Text style={styles.promptLabel}>Say this word</Text>
          {revealVocabMeaning && (
            <Text style={styles.meaningHint}>{voicePrompt.meaning}</Text>
          )}
        </View>
      ) : (
        // Legacy kanji-only branch — still gated by revealHiragana for consistency.
        <View style={styles.prompt}>
          <Text style={styles.character}>{character}</Text>
          <Text style={styles.promptLabel}>Say the {readingLabel}</Text>
          {revealHiragana && <Text style={styles.expectedHint}>({correctReadings[0]})</Text>}
        </View>
      )}

      {/* Mic button — hidden while evaluating */}
      {phase !== 'evaluating' && (
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

      {!permissionGranted && phase === 'idle' && (
        <Text style={styles.permissionWarning}>
          Microphone permission required for voice evaluation
        </Text>
      )}

      {/* Dev-only simulator helpers — stripped from release builds via __DEV__.
          Useful when iOS simulator can't capture real speech. Remove after
          smoke-testing is complete. */}
      {__DEV__ && phase !== 'listening' && phase !== 'evaluating' && (
        <View style={styles.devRow}>
          <TouchableOpacity
            style={[styles.devBtn, styles.devBtnWrong]}
            onPress={forceWrong}
            accessibilityLabel="Dev only: force wrong result"
          >
            <Text style={styles.devBtnText}>💥 Force wrong</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.devBtn, styles.devBtnCorrect]}
            onPress={forceCorrect}
            accessibilityLabel="Dev only: force correct result"
          >
            <Text style={styles.devBtnText}>✅ Force correct</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

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
  permissionWarning: { ...typography.caption, color: colors.warning, textAlign: 'center' },

  // Dev-only simulator force-button styles
  devRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    justifyContent: 'center',
  },
  devBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
  },
  devBtnWrong: {
    backgroundColor: 'rgba(166, 61, 61, 0.15)',
    borderColor: 'rgba(166, 61, 61, 0.5)',
  },
  devBtnCorrect: {
    backgroundColor: 'rgba(60, 160, 100, 0.15)',
    borderColor: 'rgba(60, 160, 100, 0.5)',
  },
  devBtnText: {
    fontSize: 11,
    color: colors.textPrimary,
    fontWeight: '500',
  },

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
