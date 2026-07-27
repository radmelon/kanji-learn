import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import type { ReviewQueueItem } from '@kanji-learn/shared'
import { fetchCoCreatedHook, recordOutcome } from '../../mnemonics/cocreationApi'
import { buildRecallQuizFromQueue, type RecallQuizCardItem } from '../../mnemonics/recallQuiz'
import { RecallQuizCard } from './RecallQuizCard'
import { colors, spacing, typography } from '../../theme'

interface Props {
  item: ReviewQueueItem
  /** The session queue — the distractor pool. Every card carries its radicals
   *  and JLPT level, which is what the shared picker ranks on. */
  pool: ReviewQueueItem[]
  sessionIndex: number
  sessionTotal: number
  minutesLeft: number | null
  onClose: () => void
  /** The check is done (answered, or skipped because it could not be built).
   *  Either way the kanji continues on its normal path. */
  onComplete: () => void
}

/**
 * The recall-quiz leg (parent spec §8): the first thing a session opens with
 * when a hook built last session owes its story→kanji check.
 *
 * The outcome feeds the hook's effectiveness EMA, not the SRS schedule — a
 * missed recall means the hook needs another layer, not that the kanji should
 * be rescheduled. The flashcard grade that follows does that job.
 */
export function RecallQuizLeg({
  item, pool, sessionIndex, sessionTotal, minutesLeft, onClose, onComplete,
}: Props) {
  const [quiz, setQuiz] = useState<RecallQuizCardItem | null>(null)
  const [mnemonicId, setMnemonicId] = useState<string | null>(null)
  const onCompleteRef = useRef(onComplete)
  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])

  // Load the hook this quiz is testing. The queue carries the due stamp but
  // not the story — one read gets both the story and the mnemonic id the
  // outcome is recorded against.
  useEffect(() => {
    let cancelled = false
    fetchCoCreatedHook(item.kanjiId)
      .then((hook) => {
        if (cancelled) return
        // No hook, or too few kanji to build tiles from. Skipping is the right
        // answer either way: an unanswerable check must never strand a session.
        if (!hook) { onCompleteRef.current(); return }
        const built = buildRecallQuizFromQueue({
          storyText: hook.storyText,
          target: item,
          pool: pool.filter((k) => k.kanjiId !== item.kanjiId),
        })
        if (!built) { onCompleteRef.current(); return }
        setMnemonicId(hook.id)
        setQuiz(built)
      })
      .catch(() => { if (!cancelled) onCompleteRef.current() })
    return () => { cancelled = true }
  }, [item, pool])

  const handleAnswered = useCallback((correct: boolean) => {
    // Fire-and-forget: a failed POST must not block the loop. A correct answer
    // clears the due stamp server-side (MnemonicService.recordOutcome), so an
    // offline session simply re-offers the check next time.
    if (mnemonicId) recordOutcome(mnemonicId, correct ? 1 : 0).catch(() => {})
    onCompleteRef.current()
  }, [mnemonicId])

  if (!quiz) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.centered}>
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
        <Text style={styles.legLabel}>Your hook</Text>
        <Text style={styles.counter}>{sessionIndex}/{sessionTotal}</Text>
        {minutesLeft !== null && <Text style={styles.timeLeft}>{minutesLeft}m left</Text>}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <RecallQuizCard item={quiz} onAnswered={handleAnswered} />
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
  scrollContent: { paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})
