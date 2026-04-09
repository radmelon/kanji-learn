// study.tsx
// Active SRS study session screen.
//
// State machine (via Zustand review.store):
//   queue loaded → card shown → reveal → grade → next card → … → finishSession()
//
// TTS crash fix (build 76):
//   Speech.stop() is called proactively on every currentIndex change so that any
//   in-flight expo-speech callback is cancelled before the card component switches.
//   This prevents the RCTFatal that occurred in weak-spots mode, where the queue
//   mixes KanjiCard and CompoundCard types — advancing from a KanjiCard to a
//   CompoundCard unmounts KanjiCard while speech may still be running.
//
// Audio session fix (build 76):
//   Audio session configuration (playsInSilentModeIOS) is managed globally in
//   _layout.tsx and re-applied on every app foreground. It is NOT called here,
//   because expo-av v16 crashes if setAudioModeAsync is called from within a
//   component that mounts/unmounts frequently (as KanjiCard does in weak-spots mode).

import { useState, useEffect, useRef, useCallback, Component, type FC } from 'react'
import type { ReviewResult } from '@kanji-learn/shared'
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Modal, Pressable,
  PanResponder, Animated, Alert,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import * as Speech from 'expo-speech'
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

function StudySession() {
  const router = useRouter()
  const { queue, currentIndex, isLoading, isComplete, error, isOfflineQueue, isWeakDrill, loadQueue, loadMissedQueue, submitResult, undoLastResult, finishSession, syncPendingSessions, reset } =
    useReviewStore()

  const [isRevealed, setIsRevealed] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  // Romaji toggle persists for the whole session — user sets it once and it sticks across cards
  const [showRomaji, setShowRomaji] = useState(false)
  const toggleRomaji = useCallback(() => setShowRomaji((v) => !v), [])
  // Holds the grade result when we need to show the mnemonic nudge first.
  // submitResult (which advances the card) is deferred until nudge is dismissed,
  // so the correct kanji stays visible behind the sheet.
  const [pendingResult, setPendingResult] = useState<ReviewResult | null>(null)
  const [sessionSummary, setSessionSummary] = useState<{
    totalItems: number; correctItems: number; newLearned: number; burned: number; studyTimeMs: number
  } | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [nudgeItem, setNudgeItem] = useState<{ kanjiId: number; character: string; meaning: string } | null>(null)
  const cardStartMs = useRef(Date.now())
  // Guard: ensure handleFinish is only called once per isComplete=true cycle.
  // Without this, a React-Native batching edge case can cause handleFinish to
  // fire a second time when setSessionSummary(null) renders before Zustand's
  // isComplete:false update lands (the "Drill missed" button re-triggers finish).
  const finishCalledRef = useRef(false)

  // ── Swipe-to-grade ─────────────────────────────────────────────────────────
  const SWIPE_THRESHOLD = 80
  const swipeX = useRef(new Animated.Value(0)).current
  // Refs so PanResponder (created once) can read current values without stale closure
  const isRevealedRef = useRef(false)
  const handleGradeRef = useRef<(q: 0 | 1 | 2 | 3 | 4 | 5) => void>(() => {})
  const didFireHapticRef = useRef(false)

  useEffect(() => { isRevealedRef.current = isRevealed }, [isRevealed])

  const panResponder = useRef(
    PanResponder.create({
      // Only steal the gesture when it's clearly horizontal and the answer is revealed
      onMoveShouldSetPanResponder: (_, gs) =>
        isRevealedRef.current &&
        Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5 &&
        Math.abs(gs.dx) > 8,
      onPanResponderGrant: () => {
        didFireHapticRef.current = false
      },
      onPanResponderMove: (_, gs) => {
        swipeX.setValue(gs.dx)
        // Single haptic "click" when crossing the commit threshold
        if (!didFireHapticRef.current && Math.abs(gs.dx) >= SWIPE_THRESHOLD) {
          didFireHapticRef.current = true
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        }
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dx > SWIPE_THRESHOLD) {
          // Fly off right → Easy
          Animated.timing(swipeX, { toValue: 600, duration: 220, useNativeDriver: true }).start(() => {
            swipeX.setValue(0)
            handleGradeRef.current(5)
          })
        } else if (gs.dx < -SWIPE_THRESHOLD) {
          // Fly off left → Again
          Animated.timing(swipeX, { toValue: -600, duration: 220, useNativeDriver: true }).start(() => {
            swipeX.setValue(0)
            handleGradeRef.current(1)
          })
        } else {
          // Snap back
          Animated.spring(swipeX, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }).start()
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(swipeX, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }).start()
      },
    })
  ).current

  // Derived animated values
  const cardRotate = swipeX.interpolate({ inputRange: [-200, 0, 200], outputRange: ['-6deg', '0deg', '6deg'] })
  const easyOpacity = swipeX.interpolate({ inputRange: [0, SWIPE_THRESHOLD * 0.4, SWIPE_THRESHOLD], outputRange: [0, 0.6, 1], extrapolate: 'clamp' })
  const againOpacity = swipeX.interpolate({ inputRange: [-SWIPE_THRESHOLD, -SWIPE_THRESHOLD * 0.4, 0], outputRange: [1, 0.6, 0], extrapolate: 'clamp' })

  useEffect(() => {
    syncPendingSessions()
    // Skip loadQueue when arriving from "Drill Weak Spots" — the weak queue
    // was already loaded by loadWeakQueue() before navigation and must not be overwritten.
    if (!useReviewStore.getState().isWeakDrill) {
      loadQueue(20)
    }
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
    // Reset card state on every advance. We deliberately do NOT call Speech.stop()
    // here — that was our previous (incorrect) fix. It fired on the initial render
    // (currentIndex=0) and on every subsequent card, which put the iOS synthesizer
    // into a brief "stopping" state. Any Speech.speak() issued while the synthesizer
    // was stopping was silently dropped, producing the "no sound" bug.
    //
    // Crash safety is handled instead by:
    //   • KanjiCard cleanup: calls Speech.stop() + sets isMountedRef=false on unmount
    //   • activeFlipRef: stops the native flip animation before it can run on a
    //     destroyed native node (the real RCTFatal root cause in weak-spots mode)
    setIsRevealed(false)
    cardStartMs.current = Date.now()
    swipeX.setValue(0)
  }, [currentIndex])

  useEffect(() => {
    if (!isComplete) {
      // New session started (loadMissedQueue or loadQueue reset isComplete) — arm the guard
      finishCalledRef.current = false
      return
    }
    if (isComplete && queue.length > 0 && !finishCalledRef.current) {
      finishCalledRef.current = true
      handleFinish()
    }
  }, [isComplete])

  const handleGrade = useCallback(
    (quality: 0 | 1 | 2 | 3 | 4 | 5) => {
      try {
        const item = queue[currentIndex]
        if (!item) return
        const result: ReviewResult = {
          kanjiId: item.kanjiId,
          quality,
          responseTimeMs: Date.now() - cardStartMs.current,
          reviewType: item.reviewType,
        }
        if ((quality === 1 || quality === 3) && item.reviewType !== 'compound') {
          // Show mnemonic nudge — defer submitResult so the card doesn't advance
          // until the user dismisses the sheet (fixes "wrong kanji underneath" bug)
          setPendingResult(result)
          setNudgeItem({
            kanjiId: item.kanjiId,
            character: item.character,
            meaning: ((item.meanings as string[] | null) ?? [])[0] ?? '',
          })
        } else {
          submitResult(result)
        }
      } catch (e: any) {
        // Event handler errors bypass the React error boundary — surface them here
        // so we can identify the root cause. Remove this Alert before final release.
        Alert.alert('handleGrade Error', e?.message ?? String(e), [{ text: 'OK' }])
        console.error('[handleGrade]', e)
      }
    },
    [queue, currentIndex, submitResult]
  )

  // Keep the ref in sync so the PanResponder closure is never stale
  useEffect(() => { handleGradeRef.current = handleGrade }, [handleGrade])

  const handleNudgeDismiss = useCallback(() => {
    if (pendingResult) {
      submitResult(pendingResult)
      setPendingResult(null)
    }
    setNudgeItem(null)
  }, [pendingResult, submitResult])

  const handleUndo = useCallback(() => {
    const ok = undoLastResult()
    if (ok) {
      setIsRevealed(false)
      isRevealedRef.current = false
      swipeX.setValue(0)
      setPendingResult(null)
      setNudgeItem(null)
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    }
  }, [undoLastResult])

  const handleFinish = useCallback(async () => {
    setIsSaving(true)
    const { results } = useReviewStore.getState()
    const correct = results.filter((r) => r.quality >= 3).length
    const newLearned = results.filter((r) => {
      const item = queue.find((q) => q.kanjiId === r.kanjiId)
      return item?.status === 'unseen'
    }).length
    const clientStudyMs = Date.now() - useReviewStore.getState().studyStartMs

    try {
      const serverData = await finishSession()
      setSessionSummary({
        totalItems: results.length,
        correctItems: correct,
        newLearned,
        burned: serverData?.burned ?? 0,
        studyTimeMs: serverData?.studyTimeMs ?? clientStudyMs,
      })
    } catch (err) {
      // Even if saving fails, show the summary so the user isn't stuck on a blank screen
      console.error('[Study] finishSession error:', err)
      setSessionSummary({
        totalItems: results.length,
        correctItems: correct,
        newLearned,
        burned: 0,
        studyTimeMs: clientStudyMs,
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
        onReview={() => {
          const ok = loadMissedQueue()
          if (ok) {
            setSessionSummary(null)
            setIsRevealed(false)
            isRevealedRef.current = false
            swipeX.setValue(0)
          }
        }}
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
        {currentIndex > 0 && (
          <TouchableOpacity onPress={handleUndo} style={styles.undoBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-undo" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>
      {isOfflineQueue && (
        <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.xs }}>
          <OfflineBanner message="Offline — showing cached cards" />
        </View>
      )}

      {/* Card — wrapped in animated view for swipe-to-grade */}
      <Animated.View
        style={[styles.cardArea, { transform: [{ translateX: swipeX }, { rotate: cardRotate }] }]}
        {...panResponder.panHandlers}
      >
        {/* "EASY" badge — appears on right pull */}
        <Animated.View style={[styles.swipeBadge, styles.swipeBadgeRight, { opacity: easyOpacity }]}
          pointerEvents="none">
          <Text style={styles.swipeBadgeText}>EASY ✓</Text>
        </Animated.View>

        {/* "AGAIN" badge — appears on left pull */}
        <Animated.View style={[styles.swipeBadge, styles.swipeBadgeLeft, { opacity: againOpacity }]}
          pointerEvents="none">
          <Text style={styles.swipeBadgeText}>AGAIN ✗</Text>
        </Animated.View>

        {currentItem.reviewType === 'compound' ? (
          <CompoundCard item={currentItem} isRevealed={isRevealed} onReveal={() => setIsRevealed(true)} />
        ) : (
          // No key prop — KanjiCard stays mounted across same-type card advances.
          // Forcing a remount via key={currentIndex} caused the cleanup to call
          // Speech.stop() on every grade press, crashing the native speech bridge
          // when the synthesizer was idle. speakingGroup is reset inside KanjiCard
          // via a useEffect on item.kanjiId instead.
          <KanjiCard
            item={currentItem}
            isRevealed={isRevealed}
            onReveal={() => setIsRevealed(true)}
            showRomaji={showRomaji}
            onToggleRomaji={toggleRomaji}
          />
        )}
      </Animated.View>

      {/* Grade buttons (only after reveal) */}
      <View style={styles.footer}>
        {isRevealed ? (
          <>
            <GradeButtons onGrade={handleGrade} />
            <Text style={styles.swipeHint}>← swipe Again · Easy swipe →</Text>
          </>
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
        onDismiss={handleNudgeDismiss}
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
              <Text style={onboardStyles.sectionTitle}>Swipe to grade quickly</Text>
              <Text style={onboardStyles.sectionBody}>
                After revealing, swipe <Text style={{ fontWeight: '700', color: colors.accent }}>right for Easy</Text> or <Text style={{ fontWeight: '700', color: colors.error }}>left for Again</Text>. Or tap the grade buttons below for all four options.
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
  undoBtn: { padding: spacing.xs },
  progressTrack: { flex: 1, height: 6, backgroundColor: colors.bgSurface, borderRadius: radius.full, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: radius.full },
  counter: { ...typography.caption, color: colors.textMuted, minWidth: 36, textAlign: 'right' },
  cardArea: { flex: 1, width: '100%' },
  footer: { width: '100%', paddingBottom: spacing.lg, minHeight: 90, justifyContent: 'center' },
  revealHint: { alignItems: 'center', paddingVertical: spacing.md },
  hintText: { ...typography.bodySmall, color: colors.textMuted },
  swipeHint: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs, opacity: 0.6 },

  // Swipe overlay badges
  swipeBadge: {
    position: 'absolute',
    top: '40%',
    zIndex: 10,
    borderWidth: 3,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  swipeBadgeRight: {
    right: spacing.xl,
    borderColor: colors.accent,
    backgroundColor: colors.accent + '22',
    transform: [{ rotate: '-8deg' }],
  },
  swipeBadgeLeft: {
    left: spacing.xl,
    borderColor: colors.error,
    backgroundColor: colors.error + '22',
    transform: [{ rotate: '8deg' }],
  },
  swipeBadgeText: {
    ...typography.h3,
    fontWeight: '900',
    letterSpacing: 1,
    color: colors.textPrimary,
  },
  loadingText: { ...typography.body, color: colors.textSecondary, marginTop: spacing.md },
  emptyTitle: { ...typography.h2, color: colors.textPrimary },
  emptySubtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: spacing.xl },
  backButton: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.lg, marginTop: spacing.md },
  backText: { ...typography.h3, color: '#fff' },
})

// ─── Error boundary ───────────────────────────────────────────────────────────
// Catches JS render errors. Uses only primitive RN components (no SafeAreaView
// from react-native-safe-area-context) so the boundary itself can't throw.
// Remove before final App Store release.

interface EBState { error: Error | null }
class StudyErrorBoundary extends Component<{ children: React.ReactNode }, EBState> {
  state: EBState = { error: null }
  static getDerivedStateFromError(error: Error): EBState { return { error } }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[StudyErrorBoundary] RENDER ERROR:', error.message)
    console.error(error.stack)
    console.error('Component stack:', info.componentStack)
    // Also show an Alert so it's visible in TestFlight without needing Metro logs
    Alert.alert(
      'Render Error (debug)',
      `${error.message}\n\n${error.stack?.slice(0, 400) ?? ''}`,
      [{ text: 'OK' }]
    )
  }
  render() {
    if (this.state.error) {
      // Use plain View/Text — NOT SafeAreaView from context, which can itself throw
      return (
        <View style={{ flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: 'center' }}>
          <Text style={{ color: 'red', fontSize: 16, fontWeight: '700', marginBottom: 12 }}>
            ⚠️ Render Error
          </Text>
          <Text style={{ color: colors.textPrimary, fontSize: 13 }}>
            {this.state.error.message}
          </Text>
        </View>
      )
    }
    return this.props.children
  }
}

const WrappedStudySession: FC = () => (
  <StudyErrorBoundary>
    <StudySession />
  </StudyErrorBoundary>
)

export default WrappedStudySession
