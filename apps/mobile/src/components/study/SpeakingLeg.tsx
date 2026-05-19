import { useState, useEffect, useCallback } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import type { ReviewQueueItem, VoicePrompt } from '@kanji-learn/shared'
import { api } from '../../lib/api'
import { VoiceEvaluator } from '../voice/VoiceEvaluator'
import type { EvalResult } from '../voice/VoiceEvaluator'
import { computeReveals } from '../voice/voiceReveal.logic'
import { NotQuiteBanner } from '../voice/NotQuiteBanner'
import { VoiceSuccessCard } from '../voice/VoiceSuccessCard'
import { colors, spacing, radius, typography } from '../../theme'

interface Props {
  item: ReviewQueueItem
  /** 1-based position of this kanji in the session queue (display only). */
  sessionIndex: number
  sessionTotal: number
  minutesLeft: number | null
  onClose: () => void
  onComplete: () => void
}

/** Strip an okurigana suffix from a kun reading (e.g. 'み.る' → 'みる'). */
const stripOkurigana = (r: string) => r.replace(/\..+$/, '')

/**
 * The speaking leg of the Practice Loop. Wraps VoiceEvaluator for one kanji.
 * VoiceEvaluator records its own attempt (POST /v1/review/voice). This wrapper
 * runs the progressive-hint ladder (attempts → reveal flags) and the success /
 * bail transitions, then calls onComplete to advance the loop.
 *
 * The voicePrompt is fetched on mount from GET /v1/review/reading-queue: when
 * the kanji has example vocab, VoiceEvaluator renders its richer vocab-word
 * layout; otherwise it falls back to the legacy kanji-reading layout.
 */
export function SpeakingLeg({ item, sessionIndex, sessionTotal, minutesLeft, onClose, onComplete }: Props) {
  const [voicePrompt, setVoicePrompt] = useState<VoicePrompt | null>(null)
  const [attempts, setAttempts] = useState(0)
  const [evaluated, setEvaluated] = useState(false)
  const [lastResult, setLastResult] = useState<EvalResult | null>(null)
  const [showInterstitial, setShowInterstitial] = useState(false)

  // Fetch the voicePrompt for this kanji on mount. The scoped reading-queue
  // path returns one row per kanjiId, each with a `voicePrompt`. On any failure
  // fall back to { type: 'kanji' } — the legacy kanji-reading layout.
  useEffect(() => {
    let cancelled = false
    api.get<{ voicePrompt: VoicePrompt }[]>(`/v1/review/reading-queue?kanjiIds=${item.kanjiId}`)
      .then((rows) => { if (!cancelled) setVoicePrompt(rows[0]?.voicePrompt ?? { type: 'kanji' }) })
      .catch(() => { if (!cancelled) setVoicePrompt({ type: 'kanji' }) })
    return () => { cancelled = true }
  }, [item.kanjiId])

  const reveals = computeReveals(attempts)

  const correctReadings = [
    ...item.kunReadings.map(stripOkurigana),
    ...item.onReadings,
  ].filter(Boolean)
  const readingLabel = item.kunReadings.length > 0 ? 'kun reading' : 'on reading'

  const handleResult = useCallback((result: EvalResult) => {
    setEvaluated(true)
    setLastResult(result)
    if (!result.correct) {
      setAttempts((a) => a + 1)
      setShowInterstitial(true)
    }
  }, [])

  const isCorrect = evaluated && lastResult?.correct === true
  const isVocab = voicePrompt?.type === 'vocab'

  // ── Loading the voicePrompt.
  if (voicePrompt === null) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Ionicons name="close" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.legLabel}>Say it</Text>
        <Text style={styles.counter}>{sessionIndex}/{sessionTotal}</Text>
        {minutesLeft !== null && (
          <Text style={styles.timeLeft}>{minutesLeft}m left</Text>
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.cardHeader}>
          <View style={styles.levelBadge}>
            <Text style={styles.levelText}>{item.jlptLevel}</Text>
          </View>
          <Text style={styles.character}>{item.character}</Text>
        </View>

        {/* Reading chips — revealed from try 2 onward (kanji-layout hint). */}
        {reveals.showKunOn && (
          <View style={styles.readingChips}>
            {item.kunReadings.length > 0 && (
              <View style={styles.readingGroup}>
                <Text style={styles.readingGroupLabel}>Kun</Text>
                {item.kunReadings.slice(0, 3).map((r) => (
                  <View key={r} style={styles.readingChip}>
                    <Text style={styles.readingChipText}>{r}</Text>
                  </View>
                ))}
              </View>
            )}
            {item.onReadings.length > 0 && (
              <View style={styles.readingGroup}>
                <Text style={styles.readingGroupLabel}>On</Text>
                {item.onReadings.slice(0, 3).map((r) => (
                  <View key={r} style={styles.readingChip}>
                    <Text style={styles.readingChipText}>{r}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Kanji meaning — also revealed from try 2 onward. */}
        {reveals.showKanjiMeaning && (
          <Text style={styles.meaningText}>{item.meanings.slice(0, 3).join(', ')}</Text>
        )}

        {isCorrect ? (
          <VoiceSuccessCard
            word={isVocab ? voicePrompt.word : item.character}
            reading={isVocab ? voicePrompt.reading : (item.kunReadings[0] ?? item.onReadings[0] ?? '')}
            targetKanji={isVocab ? voicePrompt.targetKanji : item.character}
            kanjiMeaning={item.meanings.slice(0, 3).join(', ')}
            vocabMeaning={isVocab ? voicePrompt.meaning : ''}
            isLast={false}
            onNext={onComplete}
          />
        ) : (
          <View style={styles.evaluatorWrapper}>
            <VoiceEvaluator
              key={item.kanjiId}
              kanjiId={item.kanjiId}
              character={item.character}
              correctReadings={correctReadings}
              readingLabel={readingLabel}
              voicePrompt={voicePrompt}
              onResult={handleResult}
              attempts={attempts}
              revealHiragana={reveals.showHiragana}
              revealPitch={reveals.forcePitch}
              revealVocabMeaning={reveals.showVocabMeaning}
            />
            <NotQuiteBanner
              visible={showInterstitial}
              onAutoDismiss={() => setShowInterstitial(false)}
            />
            {/* Bail option — appears from try 4+ (attempts >= 3). */}
            {reveals.canBail && (
              <TouchableOpacity style={styles.continueBtn} onPress={onComplete} activeOpacity={0.85}>
                <Text style={styles.continueText}>Continue</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.sm,
  },
  closeBtn: { padding: spacing.xs },
  legLabel: { ...typography.h3, color: colors.textPrimary, flex: 1 },
  counter: { ...typography.caption, color: colors.textMuted, minWidth: 36, textAlign: 'right' },
  timeLeft: { ...typography.caption, color: colors.textMuted, minWidth: 48, textAlign: 'right' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, gap: spacing.lg },
  cardHeader: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.md },
  levelBadge: {
    backgroundColor: colors.bgSurface, paddingHorizontal: spacing.sm,
    paddingVertical: 2, borderRadius: radius.sm,
  },
  levelText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  character: { fontSize: 96, color: colors.textPrimary, textAlign: 'center' },
  meaningText: { ...typography.h3, color: colors.textSecondary, textAlign: 'center' },
  readingChips: { flexDirection: 'row', gap: spacing.md, justifyContent: 'center', flexWrap: 'wrap' },
  readingGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  readingGroupLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
  readingChip: {
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 3,
  },
  readingChipText: { ...typography.reading, color: colors.textSecondary },
  evaluatorWrapper: {
    backgroundColor: colors.bgCard, borderRadius: radius.xl,
    borderWidth: 1, borderColor: colors.border, padding: spacing.xl,
  },
  continueBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.primary, paddingVertical: spacing.md,
    borderRadius: radius.lg, marginTop: spacing.sm,
  },
  continueText: { ...typography.h3, color: '#fff' },
})
