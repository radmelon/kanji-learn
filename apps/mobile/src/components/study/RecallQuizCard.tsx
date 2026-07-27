import { useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { shuffleChoices, type RecallQuizCardItem } from '../../mnemonics/recallQuiz'
import { colors, spacing, radius, typography } from '../../theme'

const FEEDBACK_MS = 1200

interface Props {
  item: RecallQuizCardItem
  /** Called once, after the feedback beat. */
  onAnswered: (correct: boolean) => void
  /** Prompt above the story. The two hosts phrase the moment differently. */
  prompt?: string
}

/**
 * The story→kanji recall quiz (parent spec §8): the learner's own hook is the
 * question, and the kanji it was built for is the answer.
 *
 * Presentational on purpose — it is rendered both inside `CoCreationSheet`
 * (the immediate quick-check, seconds after saving) and full-screen by
 * `RecallQuizLeg` (the next-session check). Fetching, outcome recording and
 * chrome all belong to the host.
 */
export function RecallQuizCard({ item, onAnswered, prompt = 'Which kanji is this hook for?' }: Props) {
  // Shuffled once per item, never per render: buildRecallQuizItem returns the
  // answer first by design, and a re-shuffle mid-feedback would move the tile
  // the learner just tapped.
  const [choices] = useState(() => shuffleChoices(item.choices))
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onAnsweredRef = useRef(onAnswered)
  useEffect(() => { onAnsweredRef.current = onAnswered }, [onAnswered])
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const handleSelect = (kanjiId: number) => {
    if (selectedId !== null) return // one answer per card
    setSelectedId(kanjiId)
    timerRef.current = setTimeout(
      () => onAnsweredRef.current(kanjiId === item.correctKanjiId),
      FEEDBACK_MS,
    )
  }

  const answered = selectedId !== null
  const gotItRight = selectedId === item.correctKanjiId

  return (
    <View style={styles.wrap}>
      <Text style={styles.prompt}>{prompt}</Text>

      <View style={styles.storyCard}>
        <Text style={styles.storyText}>{item.storyText}</Text>
      </View>

      <View style={styles.tileRow}>
        {choices.map((choice) => {
          const isCorrect = choice.kanjiId === item.correctKanjiId
          const isSelected = selectedId === choice.kanjiId
          let tileStyle = {}
          let textColor: string = colors.textPrimary

          if (answered) {
            if (isCorrect) {
              tileStyle = { backgroundColor: colors.success + '22', borderColor: colors.success }
              textColor = colors.success
            } else if (isSelected) {
              tileStyle = { backgroundColor: colors.error + '22', borderColor: colors.error }
              textColor = colors.error
            } else {
              tileStyle = { opacity: 0.4 }
            }
          }

          return (
            <TouchableOpacity
              key={choice.kanjiId}
              style={[styles.tile, tileStyle]}
              onPress={() => handleSelect(choice.kanjiId)}
              disabled={answered}
              activeOpacity={0.8}
            >
              <Text style={[styles.tileText, { color: textColor }]}>{choice.character}</Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {answered && (
        <View style={styles.feedbackRow}>
          <Ionicons
            name={gotItRight ? 'checkmark-circle' : 'close-circle'}
            size={18}
            color={gotItRight ? colors.success : colors.error}
          />
          {/* A miss is information, not a failure — the hook needs another
              layer, which is what the deepen path is for. Never scold. */}
          <Text style={[styles.feedbackText, { color: gotItRight ? colors.success : colors.textSecondary }]}>
            {gotItRight ? 'That’s the one.' : 'Not quite — we’ll come back to it.'}
          </Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  prompt: { ...typography.body, color: colors.textPrimary },
  storyCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  storyText: { ...typography.body, color: colors.textPrimary, lineHeight: 22 },
  // Wraps rather than scrolls: four tiles fit a phone row, and a small deck
  // can yield two or three.
  tileRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgSurface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
  },
  tileText: { fontSize: 36, lineHeight: 44 },
  feedbackRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  feedbackText: { ...typography.bodySmall },
})
