import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView,
  AccessibilityInfo,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as SecureStore from 'expo-secure-store'
import { VoiceEvaluator } from '../../src/components/voice/VoiceEvaluator'
import type { EvalResult } from '../../src/components/voice/VoiceEvaluator'
import { computeReveals } from '../../src/components/voice/voiceReveal.logic'
import { NotQuiteBanner } from '../../src/components/voice/NotQuiteBanner'
import { VoiceSuccessCard } from '../../src/components/voice/VoiceSuccessCard'
import { api } from '../../src/lib/api'
import { colors, spacing, radius, typography } from '../../src/theme'
import type { VoicePrompt } from '@kanji-learn/shared'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReadingQueueItem {
  kanjiId: number
  character: string
  meanings: string[]
  jlptLevel: string
  kunReadings: string[]
  onReadings: string[]
  status: string
  /** Attached by the API — directs VoiceEvaluator to render vocab-word layout
   *  when available, falling back to legacy kanji-level prompt when missing
   *  (protects against API skew during deploy). */
  voicePrompt?: VoicePrompt
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

// ─── Info content ─────────────────────────────────────────────────────────────

const INFO_VOICE = [
  {
    title: 'Difficulty levels',
    body: "Easy: individual kanji readings. Medium: short compounds. Hard: full sentences with multiple kanji. Higher difficulties award more XP.",
  },
  {
    title: 'How evaluation works',
    body: "Your spoken reading is transcribed and compared to the expected reading. Partial credit is given for close answers — accents and minor pitch differences are not penalised.",
  },
]

const INFO_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 }

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
  // Difficulty state and SecureStore persistence are retained for future
  // restoration as a "starting-tier" preference; the picker UI and
  // changeDifficulty callback were removed during the progressive-hints
  // refactor. See ENHANCEMENTS.md — "Voice drill: restore difficulty-picker
  // as a starting-tier preference".
  const [difficulty, setDifficulty] = useState<Difficulty>(1)
  const [showDifficultyPicker, setShowDifficultyPicker] = useState(false)
  const [activeInfo, setActiveInfo] = useState<string | null>(null)
  const [attempts, setAttempts] = useState(0)
  const [showInterstitial, setShowInterstitial] = useState(false)
  const [lastResult, setLastResult] = useState<EvalResult | null>(null)

  const toggleInfo = useCallback((id: string) => {
    setActiveInfo((prev) => (prev === id ? null : id))
  }, [])

  useEffect(() => {
    loadQueue()
    SecureStore.getItemAsync(DIFFICULTY_KEY).then((val) => {
      const parsed = parseInt(val ?? '1', 10)
      if (parsed >= 1 && parsed <= 4) setDifficulty(parsed as Difficulty)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const item = queue[currentIndex]
    if (attempts === 2 && item?.voicePrompt?.type === 'vocab') {
      AccessibilityInfo.announceForAccessibility(
        `Reading hint: ${item.voicePrompt.reading}`
      )
    }
    if (attempts === 3) {
      AccessibilityInfo.announceForAccessibility('Pitch accent revealed')
    }
  }, [attempts, currentIndex, queue])

  const loadQueue = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    setDone(false)
    setCurrentIndex(0)
    setResults([])
    setEvaluated(false)
    setAttempts(0)
    setShowInterstitial(false)
    setLastResult(null)
    try {
      const data = await api.get<ReadingQueueItem[]>('/v1/review/reading-queue?limit=8')
      setQueue(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reading queue')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const handleResult = useCallback((result: EvalResult) => {
    const item = queue[currentIndex]
    if (!item) return
    setResults((prev) => [...prev, { kanjiId: item.kanjiId, passed: result.correct }])
    setEvaluated(true)
    setLastResult(result)
    if (!result.correct) {
      setAttempts((a) => a + 1)
      setShowInterstitial(true)
    }
  }, [queue, currentIndex])

  const handleNext = useCallback(() => {
    if (currentIndex + 1 >= queue.length) {
      setDone(true)
    } else {
      setCurrentIndex((i) => i + 1)
      setEvaluated(false)
      setAttempts(0)
      setShowInterstitial(false)
      setLastResult(null)
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

  const { label } = pickReading(currentItem)
  const progress = currentIndex / queue.length
  const isLast = currentIndex + 1 >= queue.length
  const reveals = computeReveals(attempts)

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
        <InfoButton id="voice" activeInfo={activeInfo} onToggle={toggleInfo} />
      </View>
      {activeInfo === 'voice' && (
        <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.sm }}>
          <InfoPanel sections={INFO_VOICE} />
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
        </View>

        {/* Reading chips — shown from try 2 onward (kun/on + kanji-level meaning) */}
        {reveals.showKunOn && (
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
        )}

        {/* Kanji-level meaning — also from try 2 onward */}
        {reveals.showKanjiMeaning && (
          <Text style={styles.meaningText}>
            {currentItem.meanings.slice(0, 3).join(', ')}
          </Text>
        )}

        {/* Success — shown when the current attempt was correct */}
        {evaluated && lastResult?.correct && (
          <VoiceSuccessCard
            word={currentItem.voicePrompt?.type === 'vocab' ? currentItem.voicePrompt.word : currentItem.character}
            reading={currentItem.voicePrompt?.type === 'vocab' ? currentItem.voicePrompt.reading : (currentItem.kunReadings[0] ?? currentItem.onReadings[0] ?? '')}
            targetKanji={currentItem.voicePrompt?.type === 'vocab' ? (currentItem.voicePrompt.targetKanji ?? currentItem.character) : currentItem.character}
            kanjiMeaning={currentItem.meanings.slice(0, 3).join(', ')}
            vocabMeaning={currentItem.voicePrompt?.type === 'vocab' ? currentItem.voicePrompt.meaning : ''}
            isLast={isLast}
            onNext={handleNext}
          />
        )}

        {/* Drill — shown while evaluating or after a wrong result */}
        {(!evaluated || !lastResult?.correct) && (
          <View style={styles.evaluatorWrapper}>
            <VoiceEvaluator
              key={currentItem.kanjiId}
              kanjiId={currentItem.kanjiId}
              character={currentItem.character}
              correctReadings={[
                ...currentItem.kunReadings.map((r) => r.replace(/\..+$/, '')),
                ...currentItem.onReadings,
              ].filter(Boolean)}
              readingLabel={label}
              onResult={handleResult}
              voicePrompt={currentItem.voicePrompt}
              attempts={attempts}
              revealHiragana={reveals.showHiragana}
              revealPitch={reveals.forcePitch}
              revealVocabMeaning={reveals.showVocabMeaning}
            />

            <NotQuiteBanner
              visible={showInterstitial}
              onAutoDismiss={() => setShowInterstitial(false)}
            />

            {/* Bail option — Next Kanji visible from try 4+ (attempts >= 3) */}
            {reveals.canBail && (
              <TouchableOpacity style={styles.nextBtn} onPress={handleNext} accessibilityHint="Advances to the next kanji">
                <Text style={styles.nextBtnText}>{isLast ? 'Finish session' : 'Next kanji'}</Text>
                <Ionicons name={isLast ? 'checkmark' : 'arrow-forward'} size={18} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
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

// ─── InfoButton ───────────────────────────────────────────────────────────────

interface InfoSection { title?: string; body: string }

function InfoButton({
  id,
  activeInfo,
  onToggle,
}: {
  id: string
  activeInfo: string | null
  onToggle: (id: string) => void
}) {
  const isOpen = activeInfo === id
  return (
    <TouchableOpacity onPress={() => onToggle(id)} hitSlop={INFO_HIT_SLOP} activeOpacity={0.7}>
      <Ionicons
        name={isOpen ? 'chevron-up-circle-outline' : 'information-circle-outline'}
        size={18}
        color={isOpen ? colors.info : colors.textMuted}
      />
    </TouchableOpacity>
  )
}

// ─── InfoPanel ────────────────────────────────────────────────────────────────

function InfoPanel({ sections }: { sections: InfoSection[] }) {
  return (
    <View style={infoStyles.panel}>
      {sections.map((s, i) => (
        <View key={i} style={[infoStyles.section, i > 0 && infoStyles.sectionSpaced]}>
          {s.title !== undefined && (
            <Text style={infoStyles.sectionTitle}>{s.title}</Text>
          )}
          <Text style={infoStyles.sectionBody}>{s.body}</Text>
        </View>
      ))}
    </View>
  )
}

const infoStyles = StyleSheet.create({
  panel: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.info + '44',
    padding: spacing.md,
  },
  section: {},
  sectionSpaced: { marginTop: spacing.sm },
  sectionTitle: {
    ...typography.caption,
    color: colors.info,
    fontWeight: '700',
    marginBottom: 3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionBody: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 18,
  },
})
