import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { WritingPractice } from '../../src/components/writing/WritingPractice'
import { api } from '../../src/lib/api'
import { colors, spacing, radius, typography } from '../../src/theme'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WritingQueueItem {
  kanjiId: number
  character: string
  meanings: string[]
  jlptLevel: string
  strokeCount: number
  kunReadings: string[]
  onReadings: string[]
  status: string
}

interface Result {
  kanjiId: number
  score: number
  passed: boolean
}

// ─── Info content ─────────────────────────────────────────────────────────────

const INFO_WRITING = [
  {
    title: 'Stroke order scoring',
    body: "Your writing is compared stroke-by-stroke against the correct stroke order. The score reflects accuracy of stroke direction, sequence, and proportion.",
  },
  {
    title: 'Improving your score',
    body: "Focus on the starting point and direction of each stroke. The order shown matches the standard taught in Japanese schools.",
  },
]

const INFO_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 }

// ─── Writing Session Screen ───────────────────────────────────────────────────

export default function WritingSession() {
  const router = useRouter()
  const [queue, setQueue] = useState<WritingQueueItem[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [results, setResults] = useState<Result[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [scrollEnabled, setScrollEnabled] = useState(true)
  const [activeInfo, setActiveInfo] = useState<string | null>(null)

  const toggleInfo = useCallback((id: string) => {
    setActiveInfo((prev) => (prev === id ? null : id))
  }, [])

  const handleDrawingChange = useCallback((isDrawing: boolean) => {
    setScrollEnabled(!isDrawing)
  }, [])

  useEffect(() => {
    loadQueue()
  }, [])

  const loadQueue = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    setDone(false)
    setCurrentIndex(0)
    setResults([])
    try {
      const data = await api.get<WritingQueueItem[]>('/v1/review/writing-queue?limit=8')
      setQueue(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load writing queue')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const handleResult = useCallback((score: number, passed: boolean) => {
    const item = queue[currentIndex]
    if (!item) return
    setResults((prev) => [...prev, { kanjiId: item.kanjiId, score, passed }])
  }, [queue, currentIndex])

  const handleNext = useCallback(() => {
    if (currentIndex + 1 >= queue.length) {
      setDone(true)
    } else {
      setCurrentIndex((i) => i + 1)
    }
  }, [currentIndex, queue.length])

  // ── Loading ──────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.loadingText}>Loading writing queue…</Text>
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
        <Text style={styles.emptyIcon}>✏️</Text>
        <Text style={styles.emptyTitle}>Nothing to practice yet</Text>
        <Text style={styles.emptySubtitle}>
          Complete some flashcard reviews first — then come back to practice writing those kanji.
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
    const avgScore = results.length > 0
      ? Math.round((results.reduce((s, r) => s + r.score, 0) / results.length) * 100)
      : 0

    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.completeCard}>
          <Text style={styles.completeEmoji}>
            {avgScore >= 80 ? '🎉' : avgScore >= 60 ? '💪' : '📖'}
          </Text>
          <Text style={styles.completeTitle}>Session complete!</Text>
          <View style={styles.statRow}>
            <StatBlock label="Practiced" value={`${results.length}`} />
            <StatBlock label="Passed" value={`${passed}`} color={colors.success} />
            <StatBlock label="Avg score" value={`${avgScore}%`} color={avgScore >= 60 ? colors.success : colors.warning} />
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

  const progress = currentIndex / queue.length

  return (
    // edges={['top']} only — the tab navigator already insets for the tab bar
    // and home indicator at the bottom. Adding 'bottom' here causes double-inset
    // which pushes the canvas controls off-screen on iPhone 15 Pro.
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Progress bar — outside the scroll so it stays pinned at top */}
      <View style={styles.progressHeader}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <InfoButton id="writing" activeInfo={activeInfo} onToggle={toggleInfo} />
      </View>
      {activeInfo === 'writing' && (
        <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.sm }}>
          <InfoPanel sections={INFO_WRITING} />
        </View>
      )}

      {/* ScrollView lets the user reach the controls when content is tall.
          The canvas PanResponder uses capture-phase so it won't be stolen. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={scrollEnabled}
      >
        <WritingPractice
          key={currentItem.kanjiId}
          kanjiId={currentItem.kanjiId}
          character={currentItem.character}
          meanings={currentItem.meanings as string[]}
          jlptLevel={currentItem.jlptLevel}
          strokeCount={currentItem.strokeCount}
          kunReadings={currentItem.kunReadings as string[]}
          onReadings={currentItem.onReadings as string[]}
          index={currentIndex + 1}
          total={queue.length}
          isLastCard={currentIndex + 1 >= queue.length}
          onResult={handleResult}
          onNext={handleNext}
          onDrawingChange={handleDrawingChange}
        />
      </ScrollView>
    </SafeAreaView>
  )
}

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
  scrollContent: { paddingBottom: spacing.xxl },
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

  loadingText: { ...typography.body, color: colors.textSecondary, marginTop: spacing.md },
  emptyIcon: { fontSize: 56 },
  emptyTitle: { ...typography.h2, color: colors.textPrimary, textAlign: 'center' },
  emptySubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
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
