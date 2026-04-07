import { useState, useEffect, useRef } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { colors, spacing, radius, typography } from '../src/theme'
import { api } from '../src/lib/api'
import type { TestQuestion, SubmitAnswer, TestResultSummary, QuestionType } from '@kanji-learn/shared'

type ScreenStatus = 'loading' | 'question' | 'feedback' | 'complete' | 'error'

const JLPT_COLORS: Record<string, string> = {
  N5: colors.n5,
  N4: colors.n4,
  N3: colors.n3,
  N2: colors.n2,
  N1: colors.n1,
}

const QUIZ_MODES: { key: QuestionType[]; label: string; icon: string }[] = [
  { key: ['meaning_recall'], label: 'Meaning', icon: 'book-outline' },
  { key: ['reading_recall'], label: 'Reading', icon: 'text-outline' },
  { key: ['kanji_from_meaning'], label: 'Kanji', icon: 'pencil-outline' },
  { key: ['vocab_reading', 'vocab_from_definition'], label: 'Vocab', icon: 'library-outline' },
  { key: ['meaning_recall', 'kanji_from_meaning', 'reading_recall', 'vocab_reading', 'vocab_from_definition'], label: 'Mixed', icon: 'shuffle-outline' },
]

const PROMPT_LABELS: Record<QuestionType, string> = {
  meaning_recall: 'What does this kanji mean?',
  kanji_from_meaning: 'Which kanji matches this meaning?',
  reading_recall: 'How do you read this kanji?',
  vocab_reading: 'How do you read this word?',
  vocab_from_definition: 'Which word means this?',
}

// Whether the prompt is a kanji character (large display) vs text
function isCharacterPrompt(qt: QuestionType) {
  return qt === 'meaning_recall' || qt === 'reading_recall'
}

// Whether the options are kanji characters (large display)
function isCharacterOptions(qt: QuestionType) {
  return qt === 'kanji_from_meaning'
}

export default function TestScreen() {
  const router = useRouter()

  const [status, setStatus] = useState<ScreenStatus>('loading')
  const [questions, setQuestions] = useState<TestQuestion[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [answers, setAnswers] = useState<SubmitAnswer[]>([])
  const [result, setResult] = useState<TestResultSummary | null>(null)
  const [quizModeIdx, setQuizModeIdx] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const cardStartMs = useRef(Date.now())

  // ── Load questions on mount ───────────────────────────────────────────────

  useEffect(() => {
    loadQuestions()
  }, [])

  const loadQuestions = async (modeIdx = quizModeIdx) => {
    setStatus('loading')
    const types = QUIZ_MODES[modeIdx]?.key ?? ['meaning_recall']
    const typesParam = types.join(',')
    try {
      const data = await api.get<TestQuestion[]>(`/v1/tests/questions?limit=10&types=${typesParam}`)
      if (!data || data.length === 0) {
        setLoadError('No quiz questions available yet — study more kanji first.')
        setStatus('error')
        return
      }
      setQuestions(data)
      setCurrentIdx(0)
      setSelectedIdx(null)
      setAnswers([])
      setResult(null)
      setLoadError(null)
      cardStartMs.current = Date.now()
      setStatus('question')
    } catch (err: any) {
      console.error('[TestScreen] loadQuestions error:', err)
      setLoadError(err?.message ?? 'Unknown error')
      setStatus('error')
    }
  }

  // ── Handle option tap ─────────────────────────────────────────────────────

  const handleOptionTap = (optionIdx: number) => {
    if (status !== 'question') return
    const q = questions[currentIdx]
    if (!q) return

    const responseMs = Date.now() - cardStartMs.current
    const newAnswer: SubmitAnswer = { kanjiId: q.kanjiId, selectedIndex: optionIdx, responseMs }

    setSelectedIdx(optionIdx)
    setStatus('feedback')

    setTimeout(() => {
      if (currentIdx + 1 < questions.length) {
        setAnswers(prev => [...prev, newAnswer])
        setCurrentIdx(i => i + 1)
        setSelectedIdx(null)
        cardStartMs.current = Date.now()
        setStatus('question')
      } else {
        submitAnswers([...answers, newAnswer])
      }
    }, 1200)
  }

  // ── Submit answers ────────────────────────────────────────────────────────

  const submitAnswers = async (finalAnswers: SubmitAnswer[]) => {
    setStatus('loading')
    try {
      const data = await api.post<TestResultSummary>('/v1/tests/submit', {
        testType: 'exit_quiz',
        questions,
        answers: finalAnswers,
      })
      setResult(data)
      setStatus('complete')
    } catch (err) {
      console.error('[TestScreen] submitAnswers error:', err)
      // Show a fallback result so the user isn't stuck
      const correct = finalAnswers.filter((a, i) => questions[i] && a.selectedIndex === questions[i].correctIndex).length
      setResult({
        sessionId: 0,
        correct,
        total: finalAnswers.length,
        scorePct: Math.round((correct / finalAnswers.length) * 100),
        passed: correct / finalAnswers.length >= 0.7,
      })
      setStatus('complete')
    }
  }

  // ── Try Again ─────────────────────────────────────────────────────────────

  const handleTryAgain = () => {
    loadQuestions(quizModeIdx)
  }

  const handleModeChange = (idx: number) => {
    setQuizModeIdx(idx)
    loadQuestions(idx)
  }

  // ── Error state ───────────────────────────────────────────────────────────

  if (status === 'error') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centeredFull}>
          <Ionicons name="alert-circle-outline" size={64} color={colors.error} />
          <Text style={styles.loadingText}>Couldn't load quiz questions.{'\n'}Check your connection and try again.</Text>
          {loadError && <Text style={styles.errorDetail}>{loadError}</Text>}
          <TouchableOpacity style={styles.retryButton} onPress={() => loadQuestions(quizModeIdx)}>
            <Ionicons name="refresh" size={16} color="#fff" />
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeButton} onPress={() => router.back()}>
            <Text style={styles.closeButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // ── Loading state ─────────────────────────────────────────────────────────

  if (status === 'loading') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centeredFull}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.loadingText}>Loading quiz…</Text>
        </View>
      </SafeAreaView>
    )
  }

  // ── Complete state ────────────────────────────────────────────────────────

  if (status === 'complete' && result) {
    const scoreColor = result.passed ? colors.primary : colors.error
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </TouchableOpacity>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: '100%' }]} />
          </View>
          <Text style={styles.counter}>{result.total}/{result.total}</Text>
        </View>

        {/* Score content */}
        <View style={styles.completeContent}>
          <View style={styles.scoreCircle}>
            <Text style={[styles.scorePct, { color: scoreColor }]}>{result.scorePct}%</Text>
            <Text style={[styles.scoreLabel, { color: scoreColor }]}>
              {result.passed ? 'Passed!' : 'Keep practicing'}
            </Text>
          </View>

          {/* Stat row */}
          <View style={styles.statRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{result.correct}/{result.total}</Text>
              <Text style={styles.statLabel}>Correct</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{result.scorePct}%</Text>
              <Text style={styles.statLabel}>Score</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <View style={[styles.passBadge, { backgroundColor: (result.passed ? colors.success : colors.error) + '22' }]}>
                <Text style={[styles.passBadgeText, { color: result.passed ? colors.success : colors.error }]}>
                  {result.passed ? 'Pass' : 'Fail'}
                </Text>
              </View>
              <Text style={styles.statLabel}>Result</Text>
            </View>
          </View>
        </View>

        {/* Footer buttons */}
        <View style={styles.completeFooter}>
          {/* Quiz mode selector */}
          <View style={styles.modeRow}>
            {QUIZ_MODES.map((m, i) => (
              <TouchableOpacity
                key={i}
                style={[styles.modeBtn, quizModeIdx === i && styles.modeBtnActive]}
                onPress={() => handleModeChange(i)}
              >
                <Ionicons name={m.icon as any} size={14} color={quizModeIdx === i ? '#fff' : colors.textMuted} />
                <Text style={[styles.modeBtnText, quizModeIdx === i && styles.modeBtnTextActive]}>{m.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => router.replace('/(tabs)')}
            activeOpacity={0.8}
          >
            <Ionicons name="home-outline" size={18} color={colors.textSecondary} />
            <Text style={styles.secondaryButtonText}>Back to Dashboard</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleTryAgain}
            activeOpacity={0.85}
          >
            <Ionicons name="refresh" size={18} color="#fff" />
            <Text style={styles.primaryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // ── Question / Feedback state ─────────────────────────────────────────────

  const q = questions[currentIdx]
  if (!q) return null

  const progress = (currentIdx) / questions.length
  const jlptColor = JLPT_COLORS[q.jlptLevel] ?? colors.textMuted

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="close" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <Text style={styles.counter}>{currentIdx + 1}/{questions.length}</Text>
      </View>

      {/* Card area */}
      <View style={styles.cardArea}>
        <View style={styles.kanjiCard}>
          {/* JLPT badge */}
          <View style={[styles.jlptBadge, { backgroundColor: jlptColor + '22', borderColor: jlptColor + '55' }]}>
            <Text style={[styles.jlptText, { color: jlptColor }]}>{q.jlptLevel}</Text>
          </View>

          {/* Prompt — large character or text depending on type */}
          {isCharacterPrompt(q.questionType) ? (
            <Text style={styles.kanjiCharacter}>{q.prompt}</Text>
          ) : (
            <Text style={styles.textPrompt}>{q.prompt}</Text>
          )}

          {/* Sub-label */}
          <Text style={styles.prompt}>{PROMPT_LABELS[q.questionType]}</Text>
        </View>
      </View>

      {/* Options */}
      <View style={styles.optionsArea}>
        {q.options.map((option, idx) => {
          const isSelected = selectedIdx === idx
          const isCorrect = idx === q.correctIndex
          const isFeedback = status === 'feedback'
          const charOpts = isCharacterOptions(q.questionType)

          let optionStyle = {}
          let textStyle = {}
          let iconName: 'checkmark-circle' | 'close-circle' | null = null
          let iconColor: string = colors.textMuted

          if (isFeedback) {
            if (isCorrect) {
              optionStyle = { backgroundColor: colors.success + '22', borderColor: colors.success }
              textStyle = { color: colors.success }
              iconName = 'checkmark-circle'
              iconColor = colors.success
            } else if (isSelected && !isCorrect) {
              optionStyle = { backgroundColor: colors.error + '22', borderColor: colors.error }
              textStyle = { color: colors.error }
              iconName = 'close-circle'
              iconColor = colors.error
            } else {
              optionStyle = { opacity: 0.4 }
            }
          }

          return (
            <TouchableOpacity
              key={idx}
              style={[styles.optionButton, charOpts && styles.optionButtonChar, optionStyle]}
              onPress={() => handleOptionTap(idx)}
              activeOpacity={0.8}
              disabled={isFeedback}
            >
              <Text style={[charOpts ? styles.optionCharText : styles.optionText, textStyle]}>{option}</Text>
              {isFeedback && iconName && !charOpts && (
                <Ionicons name={iconName} size={20} color={iconColor} />
              )}
            </TouchableOpacity>
          )
        })}
      </View>
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centeredFull: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
    textAlign: 'center',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  closeBtn: {
    padding: spacing.xs,
  },
  progressTrack: {
    flex: 1,
    height: 6,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: radius.full,
  },
  counter: {
    ...typography.caption,
    color: colors.textMuted,
    minWidth: 36,
    textAlign: 'right',
  },

  // Card area
  cardArea: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    justifyContent: 'center',
  },
  kanjiCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
    position: 'relative',
  },
  jlptBadge: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  jlptText: {
    ...typography.caption,
    fontWeight: '700',
  },
  kanjiCharacter: {
    ...typography.kanjiDisplay,
    color: colors.textPrimary,
    marginTop: spacing.md,
  },
  textPrompt: {
    ...typography.h2,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  prompt: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },

  // Options
  optionsArea: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  optionButton: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionButtonChar: {
    justifyContent: 'center',
    paddingVertical: spacing.lg,
  },
  optionText: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
  },
  optionCharText: {
    fontSize: 32,
    lineHeight: 40,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  modeRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
    justifyContent: 'center',
    paddingBottom: spacing.xs,
  },
  modeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  modeBtnText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  modeBtnTextActive: { color: '#fff' },

  // Complete state
  completeContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.xl,
  },
  scoreCircle: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  scorePct: {
    fontSize: 64,
    fontWeight: '700',
    lineHeight: 72,
  },
  scoreLabel: {
    ...typography.h2,
  },
  statRow: {
    flexDirection: 'row',
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    gap: spacing.lg,
    width: '100%',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  statValue: {
    ...typography.h2,
    color: colors.textPrimary,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  statDivider: {
    width: 1,
    height: 36,
    backgroundColor: colors.border,
  },
  passBadge: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  passBadgeText: {
    ...typography.bodySmall,
    fontWeight: '600',
  },
  completeFooter: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md + 2,
  },
  primaryButtonText: {
    ...typography.h3,
    color: '#fff',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
  },
  secondaryButtonText: {
    ...typography.h3,
    color: colors.textSecondary,
  },
  errorDetail: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    fontFamily: 'Courier',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.xl,
  },
  retryButtonText: {
    ...typography.h3,
    color: '#fff',
  },
  closeButton: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  closeButtonText: {
    ...typography.body,
    color: colors.textSecondary,
  },
})
