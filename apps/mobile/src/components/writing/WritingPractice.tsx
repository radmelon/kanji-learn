import { useState, useCallback, useEffect } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { WritingCanvas } from './WritingCanvas'
import { StrokeOrderAnimation } from './StrokeOrderAnimation'
import { useKanjiStrokes } from '../../hooks/useKanjiStrokes'
import { scoreStrokes } from '../../lib/strokeScoring'
import type { StrokeScore, FeedbackItem, UserStroke } from '../../lib/strokeScoring'
import { api } from '../../lib/api'
import { colors, spacing, radius, typography } from '../../theme'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  kanjiId: number
  character: string
  meanings: string[]
  jlptLevel: string
  strokeCount: number
  kunReadings?: string[]
  onReadings?: string[]
  index: number
  total: number
  isLastCard?: boolean
  onResult: (score: number, passed: boolean) => void
  onNext?: () => void
  onDrawingChange?: (isDrawing: boolean) => void
}

interface MnemonicHook {
  id: string
  storyText: string
  type: 'system' | 'user'
}

type Mode = 'watch' | 'practice'

const HOOK_PURPLE_BG = '#2A2560'
const HOOK_PURPLE_LABEL = '#9B93F7'
const HOOK_PURPLE_TEXT = '#CCC8FF'

// ─── Writing Practice ─────────────────────────────────────────────────────────

export function WritingPractice({
  kanjiId, character, meanings, jlptLevel, strokeCount, kunReadings = [], onReadings = [],
  index, total, isLastCard = false, onResult, onNext, onDrawingChange,
}: Props) {
  const [mode, setMode] = useState<Mode>('watch')
  const [currentStrokeCount, setCurrentStrokeCount] = useState(0)
  const [submitted, setSubmitted] = useState(false)
  const [scoreResult, setScoreResult] = useState<StrokeScore | null>(null)
  const [canvasKey, setCanvasKey] = useState(0)
  const [hook, setHook] = useState<MnemonicHook | null>(null)

  const { strokes: refStrokes } = useKanjiStrokes(character)

  useEffect(() => {
    api.get<MnemonicHook[]>(`/v1/mnemonics/${kanjiId}`)
      .then((data) => {
        const user = data.find((m) => m.type === 'user')
        const system = data.find((m) => m.type === 'system')
        setHook(user ?? system ?? null)
      })
      .catch(() => {})
  }, [kanjiId])

  const handleStrokeAdded = useCallback((count: number) => {
    setCurrentStrokeCount(count)
  }, [])

  const handleSubmit = useCallback(async (userStrokes: UserStroke[], count: number) => {
    const result = scoreStrokes(
      userStrokes,
      refStrokes.map((s) => ({ d: s.d })),
      335,
      260,
    )
    const passed = result.total >= 0.6
    try {
      await api.post('/v1/review/writing', { kanjiId, score: result.total, strokeCount: count })
    } catch {}
    setScoreResult(result)
    setSubmitted(true)
    onResult(result.total, passed)
  }, [kanjiId, refStrokes, onResult])

  const handleRetry = useCallback(() => {
    setSubmitted(false)
    setScoreResult(null)
    setCurrentStrokeCount(0)
    setCanvasKey((k) => k + 1)  // remount canvas → clears all drawn strokes
  }, [])

  const handleWatchAgain = useCallback(() => {
    setMode('watch')
    setSubmitted(false)
    setScoreResult(null)
    setCurrentStrokeCount(0)
  }, [])

  const primaryMeaning = meanings[0] ?? ''
  const jlptColor = (colors as any)[jlptLevel.toLowerCase()] ?? colors.textMuted

  return (
    <View style={styles.container}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Writing practice</Text>
          <View style={styles.subRow}>
            <Text style={styles.subChar}>{character}</Text>
            <Text style={styles.subDot}>·</Text>
            <Text style={styles.subMeaning}>{primaryMeaning}</Text>
            <Text style={styles.subDot}>·</Text>
            <Text style={[styles.subJlpt, { color: jlptColor }]}>{jlptLevel}</Text>
          </View>
          {(kunReadings.length > 0 || onReadings.length > 0) && (
            <View style={styles.readingChips}>
              {kunReadings.length > 0 && (
                <View style={styles.readingGroup}>
                  <Text style={styles.readingGroupLabel}>Kun</Text>
                  {kunReadings.slice(0, 3).map((r) => (
                    <View key={r} style={styles.readingChip}>
                      <Text style={styles.readingChipText}>{r}</Text>
                    </View>
                  ))}
                </View>
              )}
              {onReadings.length > 0 && (
                <View style={styles.readingGroup}>
                  <Text style={styles.readingGroupLabel}>On</Text>
                  {onReadings.slice(0, 3).map((r) => (
                    <View key={r} style={[styles.readingChip, styles.readingChipOn]}>
                      <Text style={[styles.readingChipText, styles.readingChipOnText]}>{r}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}
        </View>
        <Text style={styles.counter}>{index} / {total}</Text>
      </View>

      {/* ── Mode toggle ─────────────────────────────────────────────────────── */}
      <View style={styles.modeRow}>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'watch' && styles.modeBtnActive]}
          onPress={() => setMode('watch')}
        >
          <Ionicons name="play-circle-outline" size={15} color={mode === 'watch' ? '#fff' : colors.textMuted} />
          <Text style={[styles.modeBtnText, mode === 'watch' && styles.modeBtnTextActive]}>Watch</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'practice' && styles.modeBtnActive]}
          onPress={() => setMode('practice')}
        >
          <Ionicons name="pencil-outline" size={15} color={mode === 'practice' ? '#fff' : colors.textMuted} />
          <Text style={[styles.modeBtnText, mode === 'practice' && styles.modeBtnTextActive]}>Practice</Text>
        </TouchableOpacity>
      </View>

      {/* ── Hook strip ──────────────────────────────────────────────────────── */}
      {hook && (
        <View style={styles.hookStrip}>
          <Text style={styles.hookLabel}>YOUR HOOK</Text>
          <ScrollView
            style={styles.hookScroll}
            showsVerticalScrollIndicator
            nestedScrollEnabled
          >
            <Text style={styles.hookText}>{hook.storyText}</Text>
          </ScrollView>
        </View>
      )}

      {/* ── Watch mode: stroke order animation ──────────────────────────────── */}
      {mode === 'watch' && (
        <>
          <StrokeOrderAnimation
            character={character}
            width={335}
            height={260}
            onDone={() => {/* auto-advance optional */}}
          />
          <TouchableOpacity style={styles.practiceNowBtn} onPress={() => setMode('practice')}>
            <Ionicons name="pencil" size={16} color="#fff" />
            <Text style={styles.practiceNowText}>Now you try →</Text>
          </TouchableOpacity>
        </>
      )}

      {/* ── Practice mode: free-draw canvas ─────────────────────────────────── */}
      {mode === 'practice' && (
        <>
          <WritingCanvas
            key={canvasKey}
            width={335}
            height={260}
            guideKanji={character}
            strokeWidth={10}
            strokeColor={colors.primary}
            onDrawingChange={onDrawingChange}
            onStrokeAdded={handleStrokeAdded}
            onSubmit={handleSubmit}
            disabled={submitted}
          />

          {/* Stroke chips */}
          <View style={styles.strokeRow}>
            <Text style={styles.strokeLabel}>Strokes:</Text>
            <View style={styles.strokeChips}>
              {Array.from({ length: strokeCount }, (_, i) => {
                const n = i + 1
                const done = n < currentStrokeCount
                const active = n === currentStrokeCount
                return (
                  <View key={n} style={[styles.chip, done && styles.chipDone, active && styles.chipActive]}>
                    <Text style={[styles.chipNum, done && styles.chipNumDone, active && styles.chipNumActive]}>
                      {n}
                    </Text>
                  </View>
                )
              })}
            </View>
          </View>

          {/* Score card */}
          {submitted && scoreResult && (
            <ScoreCard result={scoreResult} />
          )}

          {/* Post-submit actions */}
          {submitted && (
            <>
              <View style={styles.postRow}>
                <TouchableOpacity style={styles.watchAgainBtn} onPress={handleWatchAgain}>
                  <Ionicons name="play-circle-outline" size={15} color={colors.textSecondary} />
                  <Text style={styles.watchAgainText}>Watch again</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.retryBtn} onPress={handleRetry}>
                  <Ionicons name="refresh" size={15} color={colors.accent} />
                  <Text style={styles.retryText}>Try again</Text>
                </TouchableOpacity>
              </View>

              {/* Next / Finish — sits below feedback, never obscures it */}
              {onNext && (
                <TouchableOpacity style={styles.nextBtn} onPress={onNext}>
                  <Text style={styles.nextBtnText}>
                    {isLastCard ? 'Finish session' : 'Next kanji →'}
                  </Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </>
      )}
    </View>
  )
}

// ─── Score card ───────────────────────────────────────────────────────────────

function ScoreCard({ result }: { result: StrokeScore }) {
  const pct = Math.round(result.total * 100)
  const passed = pct >= 60
  const barColor = pct >= 80 ? colors.success : pct >= 60 ? colors.warning : colors.error

  return (
    <View style={styles.scoreCard}>
      {/* Total score bar */}
      <View style={styles.scoreTotalRow}>
        <Text style={[styles.scoreTotalLabel, { color: barColor }]}>
          {pct >= 80 ? 'Excellent!' : pct >= 60 ? 'Good effort' : 'Keep practicing'}
        </Text>
        <Text style={[styles.scoreTotalPct, { color: barColor }]}>{pct}%</Text>
      </View>
      <View style={styles.scoreBarTrack}>
        <View style={[styles.scoreBarFill, { width: `${pct}%`, backgroundColor: barColor }]} />
      </View>

      {/* Axis breakdown */}
      <View style={styles.axisRow}>
        <AxisPill label="Count"     value={result.countScore}     />
        <AxisPill label="Direction" value={result.directionScore} />
        <AxisPill label="Order"     value={result.orderScore}     />
      </View>

      {/* Per-line feedback */}
      {result.feedback.map((item, i) => (
        <FeedbackRow key={i} item={item} />
      ))}
    </View>
  )
}

function AxisPill({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100)
  const color = pct >= 80 ? colors.success : pct >= 60 ? colors.warning : colors.error
  return (
    <View style={styles.axisPill}>
      <Text style={[styles.axisPct, { color }]}>{pct}%</Text>
      <Text style={styles.axisLabel}>{label}</Text>
    </View>
  )
}

function FeedbackRow({ item }: { item: FeedbackItem }) {
  const iconName = item.icon === 'check' ? 'checkmark-circle' : item.icon === 'close' ? 'close-circle' : 'warning'
  const iconColor = item.icon === 'check' ? colors.success : item.icon === 'close' ? colors.error : colors.warning
  return (
    <View style={styles.feedbackRow}>
      <Ionicons name={iconName} size={16} color={iconColor} />
      <View style={styles.feedbackRowText}>
        <Text style={styles.feedbackRowLabel}>{item.label}</Text>
        <Text style={styles.feedbackRowDetail}>{item.detail}</Text>
      </View>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { gap: spacing.sm, paddingBottom: spacing.md },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingHorizontal: spacing.md, paddingTop: spacing.sm,
  },
  title: { ...typography.h3, color: colors.textPrimary },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  subChar: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  subDot: { ...typography.caption, color: colors.textMuted },
  subMeaning: { ...typography.caption, color: colors.textSecondary },
  subJlpt: { ...typography.caption, fontWeight: '700' },
  counter: { ...typography.bodySmall, color: colors.textMuted, paddingTop: 2 },
  readingChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  readingGroup: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  readingGroupLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
  readingChip: { backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  readingChipOn: { backgroundColor: colors.bgElevated, borderColor: colors.accent + '66' },
  readingChipText: { ...typography.caption, color: colors.textSecondary },
  readingChipOnText: { color: colors.accent },

  modeRow: {
    flexDirection: 'row', gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  modeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: spacing.sm,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.bgCard,
  },
  modeBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  modeBtnText: { ...typography.bodySmall, color: colors.textMuted },
  modeBtnTextActive: { color: '#fff', fontWeight: '600' },

  hookStrip: {
    marginHorizontal: spacing.md, backgroundColor: HOOK_PURPLE_BG,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs,
    gap: 4,
  },
  hookScroll: {
    maxHeight: 100,
  },
  hookLabel: { fontSize: 10, color: HOOK_PURPLE_LABEL, fontWeight: '600', letterSpacing: 0.8 },
  hookText: { ...typography.bodySmall, color: HOOK_PURPLE_TEXT, lineHeight: 19, paddingBottom: spacing.xs },

  practiceNowBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginHorizontal: spacing.md,
    backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md,
  },
  practiceNowText: { ...typography.h3, color: '#fff' },

  strokeRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, gap: spacing.sm, flexWrap: 'wrap',
  },
  strokeLabel: { ...typography.caption, color: colors.textSecondary, marginRight: 2 },
  strokeChips: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  chip: {
    width: 28, height: 28, borderRadius: radius.sm,
    backgroundColor: colors.bgCard, borderWidth: 0.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  chipDone: { backgroundColor: '#1A3D35', borderColor: colors.success },
  chipActive: { backgroundColor: colors.bgElevated, borderColor: colors.primary },
  chipNum: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  chipNumDone: { color: colors.success },
  chipNumActive: { color: colors.primary },

  scoreCard: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  scoreTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  scoreTotalLabel: { ...typography.bodySmall, fontWeight: '600' },
  scoreTotalPct: { ...typography.h3 },
  scoreBarTrack: { height: 6, backgroundColor: colors.bgSurface, borderRadius: radius.full, overflow: 'hidden' },
  scoreBarFill: { height: '100%', borderRadius: radius.full },
  axisRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
  axisPill: {
    flex: 1, alignItems: 'center', gap: 2,
    backgroundColor: colors.bgSurface, borderRadius: radius.md, paddingVertical: spacing.sm,
  },
  axisPct: { ...typography.h3 },
  axisLabel: { ...typography.caption, color: colors.textMuted },
  feedbackRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingTop: spacing.xs },
  feedbackRowText: { flex: 1, gap: 2 },
  feedbackRowLabel: { ...typography.bodySmall, color: colors.textPrimary, fontWeight: '600' },
  feedbackRowDetail: { ...typography.caption, color: colors.textSecondary, lineHeight: 16 },

  postRow: {
    flexDirection: 'row', justifyContent: 'center', gap: spacing.xl,
    paddingVertical: spacing.xs,
  },
  watchAgainBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  watchAgainText: { ...typography.bodySmall, color: colors.textSecondary },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  retryText: { ...typography.bodySmall, color: colors.accent },

  nextBtn: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  nextBtnText: { ...typography.h3, color: '#fff' },
})
