import { useState, useCallback } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import type { ReviewQueueItem } from '@kanji-learn/shared'
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
 * v1 renders VoiceEvaluator's legacy kanji-reading layout (no voicePrompt) —
 * the richer vocab-word layout is deferred to Plan C (see plan §"Design
 * decisions"). The progressive-hint ladder works in either layout.
 */
export function SpeakingLeg({ item, sessionIndex, sessionTotal, minutesLeft, onClose, onComplete }: Props) {
  const [attempts, setAttempts] = useState(0)
  const [evaluated, setEvaluated] = useState(false)
  const [lastResult, setLastResult] = useState<EvalResult | null>(null)
  const [showInterstitial, setShowInterstitial] = useState(false)

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

        {/* Reading chips — revealed from try 2 onward. */}
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
            word={item.character}
            reading={item.kunReadings[0] ?? item.onReadings[0] ?? ''}
            targetKanji={item.character}
            kanjiMeaning={item.meanings.slice(0, 3).join(', ')}
            vocabMeaning=""
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
