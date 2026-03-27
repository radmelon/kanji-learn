import { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useReviewStore } from '../../src/stores/review.store'
import { KanjiCard } from '../../src/components/study/KanjiCard'
import { GradeButtons } from '../../src/components/study/GradeButtons'
import { SessionComplete } from '../../src/components/study/SessionComplete'
import { colors, spacing, radius, typography } from '../../src/theme'

export default function StudySession() {
  const router = useRouter()
  const { queue, currentIndex, isLoading, isComplete, loadQueue, submitResult, finishSession, reset } =
    useReviewStore()

  const [isRevealed, setIsRevealed] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [sessionSummary, setSessionSummary] = useState<{
    totalItems: number; correctItems: number; newLearned: number; burned: number
  } | null>(null)
  const cardStartMs = useRef(Date.now())

  useEffect(() => {
    loadQueue(20)
    return () => reset()
  }, [])

  useEffect(() => {
    setIsRevealed(false)
    cardStartMs.current = Date.now()
  }, [currentIndex])

  useEffect(() => {
    if (isComplete && queue.length > 0) {
      handleFinish()
    }
  }, [isComplete])

  const handleGrade = useCallback(
    (quality: 0 | 1 | 2 | 3 | 4 | 5) => {
      const item = queue[currentIndex]
      if (!item) return
      submitResult({
        kanjiId: item.kanjiId,
        quality,
        responseTimeMs: Date.now() - cardStartMs.current,
        reviewType: item.reviewType,
      })
    },
    [queue, currentIndex, submitResult]
  )

  const handleFinish = useCallback(async () => {
    setIsSaving(true)
    try {
      const { results } = useReviewStore.getState()
      const correct = results.filter((r) => r.quality >= 3).length
      const newLearned = results.filter((r) => {
        const item = queue.find((q) => q.kanjiId === r.kanjiId)
        return item?.status === 'unseen'
      }).length
      await finishSession()
      setSessionSummary({
        totalItems: results.length,
        correctItems: correct,
        newLearned,
        burned: 0, // derived server-side; show 0 here
      })
    } finally {
      setIsSaving(false)
    }
  }, [finishSession, queue])

  // ── Loading ──────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.loadingText}>Loading reviews…</Text>
      </SafeAreaView>
    )
  }

  // ── Empty queue ───────────────────────────────────────────────────────────

  if (!isLoading && queue.length === 0) {
    return (
      <SafeAreaView style={styles.safe}>
        <Ionicons name="checkmark-circle" size={64} color={colors.success} />
        <Text style={styles.emptyTitle}>All caught up!</Text>
        <Text style={styles.emptySubtitle}>No reviews due right now. Come back later.</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backText}>Back to Dashboard</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  // ── Session complete ──────────────────────────────────────────────────────

  if (sessionSummary) {
    return (
      <SessionComplete
        {...sessionSummary}
        onDone={() => router.replace('/(tabs)')}
        onReview={() => { reset(); loadQueue(20) }}
      />
    )
  }

  if (isSaving) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.loadingText}>Saving session…</Text>
      </SafeAreaView>
    )
  }

  const currentItem = queue[currentIndex]
  if (!currentItem) return null

  const progress = currentIndex / queue.length

  // ── Main review UI ────────────────────────────────────────────────────────

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
        <Text style={styles.counter}>
          {currentIndex + 1}/{queue.length}
        </Text>
      </View>

      {/* Card */}
      <View style={styles.cardArea}>
        <KanjiCard item={currentItem} isRevealed={isRevealed} onReveal={() => setIsRevealed(true)} />
      </View>

      {/* Grade buttons (only after reveal) */}
      <View style={styles.footer}>
        {isRevealed ? (
          <GradeButtons onGrade={handleGrade} />
        ) : (
          <View style={styles.revealHint}>
            <Text style={styles.hintText}>Tap the card to reveal the answer</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.sm, width: '100%' },
  closeBtn: { padding: spacing.xs },
  progressTrack: { flex: 1, height: 6, backgroundColor: colors.bgSurface, borderRadius: radius.full, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: radius.full },
  counter: { ...typography.caption, color: colors.textMuted, minWidth: 36, textAlign: 'right' },
  cardArea: { flex: 1, width: '100%' },
  footer: { width: '100%', paddingBottom: spacing.lg, minHeight: 90, justifyContent: 'center' },
  revealHint: { alignItems: 'center', paddingVertical: spacing.md },
  hintText: { ...typography.bodySmall, color: colors.textMuted },
  loadingText: { ...typography.body, color: colors.textSecondary, marginTop: spacing.md },
  emptyTitle: { ...typography.h2, color: colors.textPrimary },
  emptySubtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: spacing.xl },
  backButton: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.lg, marginTop: spacing.md },
  backText: { ...typography.h3, color: '#fff' },
})
