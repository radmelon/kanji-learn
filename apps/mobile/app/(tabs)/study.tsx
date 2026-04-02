import { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Modal, Pressable,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as SecureStore from 'expo-secure-store'
import { useReviewStore } from '../../src/stores/review.store'
import { OfflineBanner } from '../../src/components/ui/OfflineBanner'
import { KanjiCard } from '../../src/components/study/KanjiCard'
import { CompoundCard } from '../../src/components/study/CompoundCard'
import { GradeButtons } from '../../src/components/study/GradeButtons'
import { SessionComplete } from '../../src/components/study/SessionComplete'
import { MnemonicNudgeSheet } from '../../src/components/study/MnemonicNudgeSheet'
import { colors, spacing, radius, typography } from '../../src/theme'

const HELP_KEY = 'kl_has_seen_study_help'

export default function StudySession() {
  const router = useRouter()
  const { queue, currentIndex, isLoading, isComplete, error, isOfflineQueue, loadQueue, submitResult, finishSession, syncPendingSessions, reset } =
    useReviewStore()

  const [isRevealed, setIsRevealed] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [sessionSummary, setSessionSummary] = useState<{
    totalItems: number; correctItems: number; newLearned: number; burned: number
  } | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [nudgeItem, setNudgeItem] = useState<{ kanjiId: number; character: string; meaning: string } | null>(null)
  const cardStartMs = useRef(Date.now())

  useEffect(() => {
    syncPendingSessions()
    loadQueue(20)
    return () => reset()
  }, [])

  useEffect(() => {
    SecureStore.getItemAsync(HELP_KEY).then((val) => {
      if (!val) setShowOnboarding(true)
    }).catch(() => {})
  }, [])

  const dismissOnboarding = useCallback(() => {
    setShowOnboarding(false)
    SecureStore.setItemAsync(HELP_KEY, '1').catch(() => {})
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
      if ((quality === 1 || quality === 3) && item.reviewType !== 'compound') {
        setNudgeItem({ kanjiId: item.kanjiId, character: item.character, meaning: item.meaning })
      }
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
        burned: 0,
      })
    } catch (err) {
      // Even if saving fails, show the summary so the user isn't stuck on a blank screen
      console.error('[Study] finishSession error:', err)
      const { results } = useReviewStore.getState()
      setSessionSummary({
        totalItems: results.length,
        correctItems: results.filter((r) => r.quality >= 3).length,
        newLearned: results.filter((r) => {
          const item = queue.find((q) => q.kanjiId === r.kanjiId)
          return item?.status === 'unseen'
        }).length,
        burned: 0,
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

  if (!isLoading && error) {
    return (
      <SafeAreaView style={styles.safe}>
        <Ionicons name="alert-circle" size={64} color={colors.error} />
        <Text style={styles.emptyTitle}>Something went wrong</Text>
        <Text style={styles.emptySubtitle}>{error}</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => loadQueue(20)}>
          <Text style={styles.backText}>Retry</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  if (!isLoading && queue.length === 0) {
    return (
      <SafeAreaView style={styles.safe}>
        <Ionicons name="checkmark-circle" size={64} color={colors.success} />
        <Text style={styles.emptyTitle}>All caught up!</Text>
        <Text style={styles.emptySubtitle}>
          {error?.includes('offline')
            ? 'You\'re offline. Connect to load new cards.'
            : 'No reviews due right now. Come back later.'}
        </Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backText}>Back to Dashboard</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  // ── Saving ────────────────────────────────────────────────────────────────

  if (isSaving) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.loadingText}>Saving session…</Text>
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

  // ── Fallback (should not reach here) ─────────────────────────────────────

  if (isComplete) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.loadingText}>Finishing up…</Text>
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
      {isOfflineQueue && (
        <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.xs }}>
          <OfflineBanner message="Offline — showing cached cards" />
        </View>
      )}

      {/* Card */}
      <View style={styles.cardArea}>
        {currentItem.reviewType === 'compound' ? (
          <CompoundCard item={currentItem} isRevealed={isRevealed} onReveal={() => setIsRevealed(true)} />
        ) : (
          <KanjiCard item={currentItem} isRevealed={isRevealed} onReveal={() => setIsRevealed(true)} />
        )}
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

      {/* Mnemonic nudge sheet (Again / Hard) */}
      <MnemonicNudgeSheet
        visible={!!nudgeItem}
        kanjiId={nudgeItem?.kanjiId ?? 0}
        character={nudgeItem?.character ?? ''}
        meaning={nudgeItem?.meaning ?? ''}
        onDismiss={() => setNudgeItem(null)}
      />

      {/* First-run onboarding overlay */}
      <Modal visible={showOnboarding} transparent animationType="fade" onRequestClose={dismissOnboarding}>
        <Pressable style={onboardStyles.backdrop} onPress={dismissOnboarding}>
          <Pressable style={onboardStyles.sheet} onPress={() => {}}>
            <Text style={onboardStyles.title}>How studying works</Text>
            <View style={onboardStyles.section}>
              <Text style={onboardStyles.sectionTitle}>Tap the card to reveal the answer</Text>
              <Text style={onboardStyles.sectionBody}>
                Try to recall the meaning before revealing. Then grade yourself honestly — your rating determines when the card appears next.
              </Text>
            </View>
            <View style={onboardStyles.section}>
              <Text style={onboardStyles.sectionTitle}>Grade buttons</Text>
              {[
                { label: 'Again', color: colors.error, desc: 'Complete blank — resets to day 1' },
                { label: 'Hard', color: colors.warning, desc: 'Struggled — interval grows slowly' },
                { label: 'Good', color: colors.success, desc: 'Correct with effort — normal progression' },
                { label: 'Easy', color: colors.accent, desc: 'Perfect recall — interval grows faster' },
              ].map(({ label, color, desc }) => (
                <View key={label} style={onboardStyles.gradeRow}>
                  <View style={[onboardStyles.gradeDot, { backgroundColor: color }]} />
                  <Text style={[onboardStyles.gradeLabel, { color }]}>{label}</Text>
                  <Text style={onboardStyles.gradeDesc}>{desc}</Text>
                </View>
              ))}
            </View>
            <View style={onboardStyles.section}>
              <Text style={onboardStyles.sectionTitle}>Kanji are "Mastered" after ~6 months</Text>
              <Text style={onboardStyles.sectionBody}>
                Cards progress: Learning → Reviewing → Remembered → Mastered. A mastered kanji has a review interval of 180+ days. Tap ⓘ next to the grade buttons anytime to review this.
              </Text>
            </View>
            <TouchableOpacity style={onboardStyles.btn} onPress={dismissOnboarding}>
              <Text style={onboardStyles.btnText}>Got it, let's study!</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  )
}

const onboardStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bgCard,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  title: { ...typography.h2, color: colors.textPrimary },
  section: { gap: spacing.sm },
  sectionTitle: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  sectionBody: { ...typography.bodySmall, color: colors.textSecondary, lineHeight: 20 },
  gradeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  gradeDot: { width: 8, height: 8, borderRadius: 4 },
  gradeLabel: { ...typography.bodySmall, fontWeight: '700', width: 44 },
  gradeDesc: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  btnText: { ...typography.h3, color: '#fff' },
})

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
