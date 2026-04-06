import { useState, useCallback, useRef } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Animated,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { usePlacementStore } from '../src/stores/placement.store'
import { colors, spacing, radius, typography } from '../src/theme'
import type { JlptLevel } from '@kanji-learn/shared'

const JLPT_LEVELS: JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1']

export default function PlacementScreen() {
  const router = useRouter()
  const {
    status, error, questions, currentQuestionIndex, phase,
    stats, passedByLevel, totalApplied,
    startTest, answerMeaning, answerReading, reset, engine,
  } = usePlacementStore()

  const [feedback, setFeedback] = useState<null | 'correct' | 'wrong'>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const feedbackOpacity = useRef(new Animated.Value(0)).current

  const showFeedback = (correct: boolean) => {
    setFeedback(correct ? 'correct' : 'wrong')
    Animated.sequence([
      Animated.timing(feedbackOpacity, { toValue: 1, duration: 100, useNativeDriver: true }),
      Animated.delay(400),
      Animated.timing(feedbackOpacity, { toValue: 0, duration: 100, useNativeDriver: true }),
    ]).start(() => setFeedback(null))
  }

  const handleMeaningAnswer = useCallback(async (index: number) => {
    if (selectedIndex !== null || feedback !== null) return
    const q = questions[currentQuestionIndex]
    const correct = index === q.correctMeaningIndex
    setSelectedIndex(index)
    if (correct) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    }
    showFeedback(correct)
    setTimeout(() => {
      setSelectedIndex(null)
      answerMeaning(correct)
    }, 600)
  }, [questions, currentQuestionIndex, selectedIndex, feedback, answerMeaning])

  const handleReadingAnswer = useCallback(async (index: number) => {
    if (selectedIndex !== null || feedback !== null) return
    const q = questions[currentQuestionIndex]
    const correct = index === q.correctReadingIndex
    setSelectedIndex(index)
    if (correct) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    }
    showFeedback(correct)
    setTimeout(() => {
      setSelectedIndex(null)
      answerReading(correct)
    }, 600)
  }, [questions, currentQuestionIndex, selectedIndex, feedback, answerReading])

  const handleStop = () => {
    // Just complete with what we have
    if (engine) {
      usePlacementStore.getState().complete()
    }
  }

  const handleSkip = () => {
    reset()
    router.replace('/(tabs)')
  }

  const handleStartStudying = () => {
    reset()
    router.replace('/(tabs)')
  }

  // ── Intro ──
  if (status === 'idle') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.introContainer}>
          <View style={styles.introIconWrap}>
            <Text style={styles.introEmoji}>🎯</Text>
          </View>
          <Text style={styles.introTitle}>Already know some kanji?</Text>
          <Text style={styles.introBody}>
            Take a short adaptive test (~5 min) to identify kanji you already know.
            Those kanji will be marked as remembered so you can start at the right level instead of reviewing basics you already know.
          </Text>
          <View style={styles.introBullets}>
            {['~50 adaptive questions', 'Adjusts to your level', "Safe — won't downgrade burned kanji"].map((item, i) => (
              <View key={i} style={styles.introBulletRow}>
                <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                <Text style={styles.introBulletText}>{item}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity style={styles.primaryBtn} onPress={startTest}>
            <Text style={styles.primaryBtnText}>Start placement test</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.skipBtn} onPress={handleSkip}>
            <Text style={styles.skipBtnText}>Skip — start from N5</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // ── Loading ──
  if (status === 'loading' || status === 'submitting') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centerView}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.loadingText}>{status === 'submitting' ? 'Saving your results…' : 'Loading…'}</Text>
        </View>
      </SafeAreaView>
    )
  }

  // ── Error ──
  if (status === 'error') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centerView}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.textMuted} />
          <Text style={styles.errorText}>Something went wrong</Text>
          {error ? <Text style={styles.errorDetail}>{error}</Text> : null}
          <TouchableOpacity style={styles.primaryBtn} onPress={startTest}>
            <Text style={styles.primaryBtnText}>Try again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.skipBtn} onPress={handleSkip}>
            <Text style={styles.skipBtnText}>Skip test</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // ── Results ──
  if (status === 'complete') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.resultsContainer}>
          <View style={styles.resultsHero}>
            <Text style={styles.resultsBigNum}>{totalApplied}</Text>
            <Text style={styles.resultsHeroLabel}>kanji recognized</Text>
          </View>
          <Text style={styles.resultsSubtitle}>
            {totalApplied > 0
              ? `These ${totalApplied} kanji are now marked as Remembered and won't appear in your early review queue.`
              : "No kanji were recognized. You'll start fresh from N5 — that's totally fine!"}
          </Text>

          {Object.keys(passedByLevel).length > 0 && (
            <View style={styles.resultsBreakdown}>
              <Text style={styles.resultsSectionTitle}>By level</Text>
              {JLPT_LEVELS.filter((l) => (passedByLevel[l] ?? 0) > 0).map((level) => (
                <View key={level} style={styles.resultsLevelRow}>
                  <Text style={styles.resultsLevelLabel}>{level}</Text>
                  <Text style={styles.resultsLevelCount}>{passedByLevel[level]} kanji</Text>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity style={styles.primaryBtn} onPress={handleStartStudying}>
            <Text style={styles.primaryBtnText}>Start studying</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    )
  }

  // ── Active question ──
  const q = questions[currentQuestionIndex]
  if (!q) return null
  const isMeaning = phase === 'meaning'
  const options = isMeaning ? q.meaningOptions : q.readingOptions
  const correctIndex = isMeaning ? q.correctMeaningIndex : q.correctReadingIndex
  const totalAsked = engine?.getTotalAsked() ?? 0

  return (
    <SafeAreaView style={styles.safe}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Text style={styles.progressText}>{totalAsked} / ~50</Text>
        <TouchableOpacity onPress={handleStop} hitSlop={10}>
          <Text style={styles.stopText}>Stop</Text>
        </TouchableOpacity>
      </View>

      {/* Character */}
      <View style={styles.charView}>
        <Text style={styles.charText}>{q.character}</Text>
        <View style={styles.charMeta}>
          <View style={styles.levelBadge}>
            <Text style={styles.levelBadgeText}>{q.jlptLevel}</Text>
          </View>
          <View style={[styles.phaseBadge, !isMeaning && styles.phaseBadgeReading]}>
            <Text style={[styles.phaseBadgeText, !isMeaning && styles.phaseBadgeTextReading]}>
              {isMeaning ? 'Meaning' : 'Reading'}
            </Text>
          </View>
        </View>
        <Text style={styles.questionPrompt}>
          {isMeaning ? 'What does this mean?' : 'How do you read this?'}
        </Text>
      </View>

      {/* Answer options */}
      <View style={styles.optionsContainer}>
        {options.map((opt, i) => {
          let bg = colors.bgCard
          let border = colors.border
          let textColor = colors.textPrimary
          if (selectedIndex !== null) {
            if (i === correctIndex) { bg = colors.success + '33'; border = colors.success; textColor = colors.success }
            else if (i === selectedIndex) { bg = colors.error + '33'; border = colors.error; textColor = colors.error }
          }
          return (
            <TouchableOpacity
              key={i}
              style={[styles.optionBtn, { backgroundColor: bg, borderColor: border }]}
              onPress={() => isMeaning ? handleMeaningAnswer(i) : handleReadingAnswer(i)}
              activeOpacity={0.7}
              disabled={selectedIndex !== null}
            >
              <Text style={[styles.optionText, { color: textColor }]}>{opt}</Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {/* Feedback overlay */}
      {feedback !== null && (
        <Animated.View style={[styles.feedbackOverlay, { opacity: feedbackOpacity }]}>
          <Ionicons
            name={feedback === 'correct' ? 'checkmark-circle' : 'close-circle'}
            size={72}
            color={feedback === 'correct' ? colors.success : colors.error}
          />
        </Animated.View>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  centerView: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl },
  loadingText: { ...typography.body, color: colors.textSecondary },
  errorText: { ...typography.h3, color: colors.textPrimary },
  errorDetail: { ...typography.caption, color: colors.textMuted, textAlign: 'center', paddingHorizontal: spacing.lg },

  // Intro
  introContainer: { flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
  introIconWrap: { alignItems: 'center' },
  introEmoji: { fontSize: 64 },
  introTitle: { ...typography.h1, color: colors.textPrimary, textAlign: 'center' },
  introBody: { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 24 },
  introBullets: { gap: spacing.sm },
  introBulletRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  introBulletText: { ...typography.body, color: colors.textSecondary },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  primaryBtnText: { ...typography.h3, color: '#fff' },
  skipBtn: { alignItems: 'center', paddingVertical: spacing.sm },
  skipBtnText: { ...typography.body, color: colors.textMuted },

  // Top bar
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  progressText: { ...typography.body, color: colors.textMuted },
  stopText: { ...typography.body, color: colors.error },

  // Character display
  charView: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  charText: { fontSize: 100, lineHeight: 120, color: colors.textPrimary, fontWeight: '300' },
  charMeta: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  levelBadge: { backgroundColor: colors.primary + '22', borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 3, borderWidth: 1, borderColor: colors.primary + '66' },
  levelBadgeText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  phaseBadge: { backgroundColor: colors.accent + '22', borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 3, borderWidth: 1, borderColor: colors.accent + '66' },
  phaseBadgeReading: { backgroundColor: colors.info + '22', borderColor: colors.info + '66' },
  phaseBadgeText: { ...typography.caption, color: colors.accent, fontWeight: '700' },
  phaseBadgeTextReading: { color: colors.info },
  questionPrompt: { ...typography.body, color: colors.textSecondary },

  // Options
  optionsContainer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  optionBtn: { borderWidth: 1.5, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.md, alignItems: 'center' },
  optionText: { ...typography.body, fontWeight: '600' },

  // Feedback overlay
  feedbackOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' },

  // Results
  resultsContainer: { padding: spacing.xl, gap: spacing.xl, flexGrow: 1 },
  resultsHero: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  resultsBigNum: { fontSize: 80, lineHeight: 90, fontWeight: '700', color: colors.primary },
  resultsHeroLabel: { ...typography.h2, color: colors.textSecondary },
  resultsSubtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 24 },
  resultsBreakdown: { gap: spacing.sm, backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  resultsSectionTitle: { ...typography.caption, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  resultsLevelRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  resultsLevelLabel: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  resultsLevelCount: { ...typography.body, color: colors.textSecondary },
})
