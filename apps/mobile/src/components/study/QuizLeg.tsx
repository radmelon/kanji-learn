import { useState, useEffect, useRef, useCallback } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import type { ReviewQueueItem, TestQuestion } from '@kanji-learn/shared'
import { api } from '../../lib/api'
import { QuizQuestion } from './QuizQuestion'
import { colors, spacing, radius, typography } from '../../theme'

interface Props {
  item: ReviewQueueItem
  /** 1-based position of this kanji in the session queue (display only). */
  sessionIndex: number
  sessionTotal: number
  minutesLeft: number | null
  onClose: () => void
  /** Called when the quiz leg is done. `passed` false routes the loop on to
   *  writing → speaking and resurfaces the card sooner (spec §4). */
  onComplete: (passed: boolean) => void
}

const FEEDBACK_MS = 1200

/**
 * The quiz leg of the Practice Loop. Serves one multiple-choice question for a
 * "maybe slipping" review kanji. A correct answer confirms the kanji; a wrong
 * answer is treated as a lapse (spec §4). The attempt is recorded to
 * testSessions/testResults via POST /v1/tests/submit (telemetry — spec §6).
 */
export function QuizLeg({ item, sessionIndex, sessionTotal, minutesLeft, onClose, onComplete }: Props) {
  const [question, setQuestion] = useState<TestQuestion | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [showFeedback, setShowFeedback] = useState(false)
  const startMs = useRef(Date.now())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // onComplete via ref so the fetch/timeout callbacks never read a stale closure.
  const onCompleteRef = useRef(onComplete)
  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  // Fetch a single quiz question for this kanji on mount.
  useEffect(() => {
    let cancelled = false
    api.get<TestQuestion | null>(`/v1/tests/question?kanjiId=${item.kanjiId}`)
      .then((q) => {
        if (cancelled) return
        // No question could be built (too few seen kanji for distractors).
        // Skip the check rather than blocking the loop — treat as a pass.
        if (!q) { onCompleteRef.current(true); return }
        setQuestion(q)
        startMs.current = Date.now()
      })
      .catch(() => { if (!cancelled) setLoadFailed(true) })
    return () => { cancelled = true }
  }, [item.kanjiId])

  const handleSelect = useCallback((index: number) => {
    if (showFeedback || !question) return
    const responseMs = Date.now() - startMs.current
    const passed = index === question.correctIndex
    setSelectedIndex(index)
    setShowFeedback(true)

    // Record the attempt for telemetry (spec §6). Fire-and-forget — a failed
    // POST must not block the loop.
    api.post('/v1/tests/submit', {
      testType: 'loop_check',
      questions: [question],
      answers: [{ kanjiId: item.kanjiId, selectedIndex: index, responseMs }],
    }).catch(() => {})

    timerRef.current = setTimeout(() => onCompleteRef.current(passed), FEEDBACK_MS)
  }, [showFeedback, question, item.kanjiId])

  // ── Question fetch failed (offline?) — don't strand the user; let them skip.
  if (loadFailed) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.centered}>
          <Text style={styles.skipText}>Couldn't load a quiz question.</Text>
          <TouchableOpacity style={styles.skipBtn} onPress={() => onComplete(true)} activeOpacity={0.85}>
            <Text style={styles.skipBtnText}>Continue</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // ── Loading the question.
  if (!question) {
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
        <Text style={styles.legLabel}>Quick check</Text>
        <Text style={styles.counter}>{sessionIndex}/{sessionTotal}</Text>
        {minutesLeft !== null && (
          <Text style={styles.timeLeft}>{minutesLeft}m left</Text>
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <QuizQuestion
          question={question}
          selectedIndex={selectedIndex}
          showFeedback={showFeedback}
          onSelect={handleSelect}
        />
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
  scrollContent: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xxl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.xl },
  skipText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  skipBtn: {
    backgroundColor: colors.primary, borderRadius: radius.lg,
    paddingVertical: spacing.md, paddingHorizontal: spacing.xl,
  },
  skipBtnText: { ...typography.h3, color: '#fff' },
})
