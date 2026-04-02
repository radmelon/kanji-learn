import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as SecureStore from 'expo-secure-store'
import { VoiceEvaluator } from '../../src/components/voice/VoiceEvaluator'
import { api } from '../../src/lib/api'
import { colors, spacing, radius, typography } from '../../src/theme'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReadingQueueItem {
  kanjiId: number
  character: string
  meanings: string[]
  jlptLevel: string
  kunReadings: string[]
  onReadings: string[]
  status: string
}

interface Result {
  kanjiId: number
  passed: boolean
}

// ─── Difficulty ───────────────────────────────────────────────────────────────

type Difficulty = 1 | 2 | 3 | 4

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  1: 'Guided',
  2: 'Prompted',
  3: 'Recall',
  4: 'Challenge',
}

const DIFFICULTY_KEY = 'kl_voice_difficulty'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Pick one representative reading for a queue item.
 *  Prefers kun (native) readings; falls back to on (Sino-Japanese). */
function pickReading(item: ReadingQueueItem): { reading: string; label: string } {
  // Strip okurigana suffix (e.g. 'み.る' → 'みる')
  const clean = (r: string) => r.replace(/\..+$/, '')

  if (item.kunReadings.length > 0) {
    return { reading: clean(item.kunReadings[0]), label: 'kun reading' }
  }
  return { reading: clean(item.onReadings[0]), label: 'on reading' }
}

// ─── Voice Reading Session Screen ─────────────────────────────────────────────

export default function VoiceSession() {
  const router = useRouter()
  const [queue, setQueue] = useState<ReadingQueueItem[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [results, setResults] = useState<Result[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [evaluated, setEvaluated] = useState(false)
  const [difficulty, setDifficulty] = useState<Difficulty>(1)
  const [showDifficultyPicker, setShowDifficultyPicker] = useState(false)

  useEffect(() => {
    loadQueue()
    SecureStore.getItemAsync(DIFFICULTY_KEY).then((val) => {
      const parsed = parseInt(val ?? '1', 10)
      if (parsed >= 1 && parsed <= 4) setDifficulty(parsed as Difficulty)
    }).catch(() => {})
  }, [])

  const changeDifficulty = useCallback((d: Difficulty) => {
    setDifficulty(d)
    setShowDifficultyPicker(false)
    SecureStore.setItemAsync(DIFFICULTY_KEY, String(d)).catch(() => {})
  }, [])

  const loadQueue = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    setDone(false)
    setCurrentIndex(0)
    setResults([])
    setEvaluated(false)
    try {
      const data = await api.get<ReadingQueueItem[]>('/v1/review/reading-queue?limit=8')
      setQueue(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reading queue')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const handleResult = useCallback((evalResult: { correct: boolean }) => {
    const item = queue[currentIndex]
    if (!item) return
    setResults((prev) => [...prev, { kanjiId: item.kanjiId, passed: evalResult.correct }])
    setEvaluated(true)
  }, [queue, currentIndex])

  const handleNext = useCallback(() => {
    if (currentIndex + 1 >= queue.length) {
      setDone(true)
    } else {
      setCurrentIndex((i) => i + 1)
      setEvaluated(false)
    }
  }, [currentIndex, queue.length])

  // ── Loading ──────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.loadingText}>Loading reading queue…</Text>
      </SafeAreaView>
    )
  }

  // ── Error ────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <SafeAreaView style={styles.centered}>
        <Ionicons name="alert-circle" size={56} color={colors.error} />
        <Text style={styles.emptyTitle}>Something went wrong</Text>
        <Text style={styles.emptySubtitle}>{error}</Text>
        <TouchableOpacity style={styles.actionBtn} onPress={loadQueue}>
          <Text style={styles.actionBtnText}>Retry</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  // ── Empty queue ───────────────────────────────────────────────────────────

  if (!isLoading && queue.length === 0) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.emptyIcon}>🎙️</Text>
        <Text style={styles.emptyTitle}>Nothing to practice yet</Text>
        <Text style={styles.emptySubtitle}>
          Complete some flashcard reviews first — then come back to practice reading those kanji aloud.
        </Text>
        <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/(tabs)/study')}>
          <Text style={styles.actionBtnText}>Go to Study</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  // ── Session complete ──────────────────────────────────────────────────────

  if (done) {
    const passed = results.filter((r) => r.passed).length
    const pct = results.length > 0 ? Math.round((passed / results.length) * 100) : 0

    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.completeCard}>
          <Text style={styles.completeEmoji}>
            {pct >= 80 ? '🎉' : pct >= 60 ? '💪' : '📖'}
          </Text>
          <Text style={styles.completeTitle}>Session complete!</Text>
          <View style={styles.statRow}>
            <StatBlock label="Practiced" value={`${results.length}`} />
            <StatBlock label="Correct" value={`${passed}`} color={colors.success} />
            <StatBlock label="Accuracy" value={`${pct}%`} color={pct >= 60 ? colors.success : colors.warning} />
          </View>
          <TouchableOpacity style={[styles.actionBtn, { width: '100%' }]} onPress={loadQueue}>
            <Text style={styles.actionBtnText}>Practice again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace('/(tabs)')}>
            <Text style={styles.secondaryBtnText}>Back to Dashboard</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // ── Active session ────────────────────────────────────────────────────────

  const currentItem = queue[currentIndex]
  if (!currentItem) return null

  const { reading, label } = pickReading(currentItem)
  const progress = currentIndex / queue.length
  const isLast = currentIndex + 1 >= queue.length

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Progress bar */}
      <View style={styles.progressHeader}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <Text style={styles.progressCount}>{currentIndex + 1} / {queue.length}</Text>
        <TouchableOpacity
          style={styles.diffBadge}
          onPress={() => setShowDifficultyPicker((v) => !v)}
          hitSlop={8}
        >
          <Text style={styles.diffBadgeText}>{DIFFICULTY_LABELS[difficulty]}</Text>
          <Ionicons name={showDifficultyPicker ? 'chevron-up' : 'chevron-down'} size={12} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Difficulty picker */}
      {showDifficultyPicker && (
        <View style={styles.diffPicker}>
          {([1, 2, 3, 4] as Difficulty[]).map((d) => (
            <TouchableOpacity
              key={d}
              style={[styles.diffOption, difficulty === d && styles.diffOptionActive]}
              onPress={() => changeDifficulty(d)}
            >
              <Text style={[styles.diffOptionText, difficulty === d && styles.diffOptionTextActive]}>
                {DIFFICULTY_LABELS[d]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Card header */}
        <View style={styles.cardHeader}>
          <View style={styles.levelBadge}>
            <Text style={styles.levelText}>{currentItem.jlptLevel}</Text>
          </View>
          {difficulty < 4 && (
            <Text style={styles.meaningText}>{currentItem.meanings.slice(0, 3).join(', ')}</Text>
          )}
        </View>

        {/* Reading chips — shown for level 1 upfront, always shown after evaluation */}
        {(difficulty === 1 || evaluated) ? (
          <View style={styles.readingChips}>
            {currentItem.kunReadings.length > 0 && (
              <View style={styles.readingGroup}>
                <Text style={styles.readingGroupLabel}>Kun</Text>
                {currentItem.kunReadings.slice(0, 3).map((r) => (
                  <View key={r} style={styles.readingChip}>
                    <Text style={styles.readingChipText}>{r}</Text>
                  </View>
                ))}
              </View>
            )}
            {currentItem.onReadings.length > 0 && (
              <View style={styles.readingGroup}>
                <Text style={styles.readingGroupLabel}>On</Text>
                {currentItem.onReadings.slice(0, 3).map((r) => (
                  <View key={r} style={[styles.readingChip, styles.readingChipOn]}>
                    <Text style={[styles.readingChipText, styles.readingChipOnText]}>{r}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : difficulty === 2 ? (
          /* Level 2 — show group labels only, not kana */
          <View style={styles.readingChips}>
            {currentItem.kunReadings.length > 0 && (
              <View style={styles.readingGroup}>
                <Text style={styles.readingGroupLabel}>Kun</Text>
                <View style={[styles.readingChip, styles.readingChipHidden]}>
                  <Text style={styles.readingChipHiddenText}>???</Text>
                </View>
              </View>
            )}
            {currentItem.onReadings.length > 0 && (
              <View style={styles.readingGroup}>
                <Text style={styles.readingGroupLabel}>On</Text>
                <View style={[styles.readingChip, styles.readingChipOn, styles.readingChipHidden]}>
                  <Text style={styles.readingChipHiddenText}>???</Text>
                </View>
              </View>
            )}
          </View>
        ) : null}

        {/* Voice evaluator */}
        <View style={styles.evaluatorWrapper}>
          <VoiceEvaluator
            key={currentItem.kanjiId}
            kanjiId={currentItem.kanjiId}
            character={currentItem.character}
            correctReadings={[
              // All valid readings for this kanji, cleaned of okurigana markers
              ...currentItem.kunReadings.map((r) => r.replace(/\..+$/, '')),
              ...currentItem.onReadings,
            ].filter(Boolean)}
            readingLabel={label}
            hideHint={difficulty > 1}
            onResult={handleResult}
          />
        </View>

        {/* Next / Finish button — shown after evaluation */}
        {evaluated && (
          <TouchableOpacity style={styles.nextBtn} onPress={handleNext}>
            <Text style={styles.nextBtnText}>{isLast ? 'Finish session' : 'Next kanji'}</Text>
            <Ionicons name={isLast ? 'checkmark' : 'arrow-forward'} size={18} color="#fff" />
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

// ─── Stat block ───────────────────────────────────────────────────────────────

function StatBlock({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.statBlock}>
      <Text style={[styles.statValue, color ? { color } : {}]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, gap: spacing.lg },
  centered: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },

  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  closeBtn: { padding: spacing.xs },
  progressTrack: {
    flex: 1,
    height: 6,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: radius.full },
  progressCount: { ...typography.caption, color: colors.textMuted },

  cardHeader: { alignItems: 'center', gap: spacing.xs, paddingTop: spacing.sm },
  levelBadge: {
    backgroundColor: colors.bgSurface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  levelText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  meaningText: { ...typography.h3, color: colors.textSecondary, textAlign: 'center' },

  readingChips: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  readingGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  readingGroupLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
  readingChip: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  readingChipOn: { backgroundColor: colors.bgElevated, borderColor: colors.accent + '66' },
  readingChipText: { ...typography.reading, color: colors.textSecondary },
  readingChipOnText: { color: colors.accent },

  diffBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  diffBadgeText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  diffPicker: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  diffOption: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  diffOptionActive: {
    backgroundColor: colors.primary + '22',
    borderColor: colors.primary + '66',
  },
  diffOptionText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  diffOptionTextActive: { color: colors.primary },
  readingChipHidden: { opacity: 0.35 },
  readingChipHiddenText: { ...typography.reading, color: colors.textMuted },

  evaluatorWrapper: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
  },

  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    marginTop: spacing.sm,
  },
  nextBtnText: { ...typography.h3, color: '#fff' },

  loadingText: { ...typography.body, color: colors.textSecondary, marginTop: spacing.md },
  emptyIcon: { fontSize: 56 },
  emptyTitle: { ...typography.h2, color: colors.textPrimary, textAlign: 'center' },
  emptySubtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  actionBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    marginTop: spacing.sm,
  },
  actionBtnText: { ...typography.h3, color: '#fff' },
  secondaryBtn: { paddingVertical: spacing.sm, marginTop: spacing.xs },
  secondaryBtnText: { ...typography.body, color: colors.textMuted },

  completeCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  completeEmoji: { fontSize: 64 },
  completeTitle: { ...typography.h1, color: colors.textPrimary },
  statRow: { flexDirection: 'row', gap: spacing.xl },
  statBlock: { alignItems: 'center', gap: 4 },
  statValue: { ...typography.h1, color: colors.textPrimary },
  statLabel: { ...typography.caption, color: colors.textMuted },
})
