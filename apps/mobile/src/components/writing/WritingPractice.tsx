import { useState, useCallback } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { WritingCanvas } from './WritingCanvas'
import { api } from '../../lib/api'
import { colors, spacing, radius, typography } from '../../theme'

interface Props {
  kanjiId: number
  character: string
  expectedStrokeCount: number
  onResult: (score: number, passed: boolean) => void
}

type Phase = 'practice' | 'result'

export function WritingPractice({ kanjiId, character, expectedStrokeCount, onResult }: Props) {
  const [phase, setPhase] = useState<Phase>('practice')
  const [score, setScore] = useState<number | null>(null)
  const [strokeCount, setStrokeCount] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = useCallback(
    async (strokes: any[], count: number) => {
      if (isSubmitting) return
      setIsSubmitting(true)
      setStrokeCount(count)

      // Score heuristic:
      // - Stroke count match: 40% weight
      // - Non-zero strokes: required
      const strokeDiff = Math.abs(count - expectedStrokeCount)
      const strokeScore = Math.max(0, 1 - strokeDiff / expectedStrokeCount)

      // Simple scoring: stroke count proximity (0–1.0)
      // In production, replace with ML stroke-order evaluation
      const finalScore = Math.round(strokeScore * 100) / 100
      const passed = finalScore >= 0.6

      try {
        await api.post('/v1/review/writing', {
          kanjiId,
          score: finalScore,
          strokeCount: count,
        })
      } catch {
        // Non-blocking — don't fail the UX on a logging error
      }

      setScore(finalScore)
      setPhase('result')
      setIsSubmitting(false)
      onResult(finalScore, passed)
    },
    [kanjiId, expectedStrokeCount, onResult, isSubmitting]
  )

  const handleRetry = useCallback(() => {
    setPhase('practice')
    setScore(null)
  }, [])

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.character}>{character}</Text>
        <View style={styles.strokeInfo}>
          <Ionicons name="pencil" size={14} color={colors.textMuted} />
          <Text style={styles.strokeLabel}>{expectedStrokeCount} strokes</Text>
        </View>
      </View>

      <WritingCanvas
        size={280}
        guideKanji={character}
        strokeWidth={10}
        strokeColor={colors.textPrimary}
        onSubmit={handleSubmit}
      />

      {phase === 'result' && score !== null && (
        <View style={styles.result}>
          <ScoreMeter score={score} />
          <Text style={styles.resultText}>
            You drew {strokeCount} stroke{strokeCount !== 1 ? 's' : ''} (expected {expectedStrokeCount})
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={handleRetry}>
            <Ionicons name="refresh" size={16} color={colors.accent} />
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

function ScoreMeter({ score }: { score: number }) {
  const pct = score * 100
  const color = pct >= 80 ? colors.success : pct >= 60 ? colors.warning : colors.error
  const label = pct >= 80 ? 'Great!' : pct >= 60 ? 'Close!' : 'Keep practicing'

  return (
    <View style={meterStyles.container}>
      <View style={meterStyles.track}>
        <View style={[meterStyles.fill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <View style={meterStyles.row}>
        <Text style={[meterStyles.label, { color }]}>{label}</Text>
        <Text style={[meterStyles.pct, { color }]}>{Math.round(pct)}%</Text>
      </View>
    </View>
  )
}

const meterStyles = StyleSheet.create({
  container: { width: '100%', gap: 6 },
  track: { height: 8, backgroundColor: colors.bgSurface, borderRadius: radius.full, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.full },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { ...typography.bodySmall, fontWeight: '600' },
  pct: { ...typography.bodySmall, fontWeight: '700' },
})

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: spacing.md },
  header: { alignItems: 'center', gap: 4 },
  character: { ...typography.kanjiLarge, color: colors.textPrimary },
  strokeInfo: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  strokeLabel: { ...typography.caption, color: colors.textMuted },
  result: { width: '100%', gap: spacing.sm, paddingHorizontal: spacing.md },
  resultText: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center' },
  retryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: spacing.sm },
  retryText: { ...typography.bodySmall, color: colors.accent },
})
