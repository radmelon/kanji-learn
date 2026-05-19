import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import type { TestQuestion, QuestionType } from '@kanji-learn/shared'
import { colors, spacing, radius, typography } from '../../theme'

const JLPT_COLORS: Record<string, string> = {
  N5: colors.n5, N4: colors.n4, N3: colors.n3, N2: colors.n2, N1: colors.n1,
}

const PROMPT_LABELS: Record<QuestionType, string> = {
  meaning_recall: 'What does this kanji mean?',
  kanji_from_meaning: 'Which kanji matches this meaning?',
  reading_recall: 'How do you read this kanji?',
  vocab_reading: 'How do you read this word?',
  vocab_from_definition: 'Which word means this?',
}

/** A kanji-character prompt is shown large; a text prompt is shown as a heading. */
const isCharacterPrompt = (qt: QuestionType) => qt === 'meaning_recall' || qt === 'reading_recall'
/** Options that are kanji characters render large and centred. */
const isCharacterOptions = (qt: QuestionType) => qt === 'kanji_from_meaning'

interface Props {
  question: TestQuestion
  /** The option index the user picked, or null before they answer. */
  selectedIndex: number | null
  /** When true, options show correct/incorrect colouring and are disabled. */
  showFeedback: boolean
  onSelect: (index: number) => void
}

/**
 * One multiple-choice quiz question — the prompt card plus four options with
 * correct/incorrect feedback styling. Reused by the Practice Loop's quiz leg.
 */
export function QuizQuestion({ question, selectedIndex, showFeedback, onSelect }: Props) {
  const jlptColor = JLPT_COLORS[question.jlptLevel] ?? colors.textMuted
  const charOpts = isCharacterOptions(question.questionType)

  return (
    <View style={styles.wrap}>
      <View style={styles.kanjiCard}>
        <View style={[styles.jlptBadge, { backgroundColor: jlptColor + '22', borderColor: jlptColor + '55' }]}>
          <Text style={[styles.jlptText, { color: jlptColor }]}>{question.jlptLevel}</Text>
        </View>
        {isCharacterPrompt(question.questionType) ? (
          <Text style={styles.kanjiCharacter}>{question.prompt}</Text>
        ) : (
          <Text style={styles.textPrompt}>{question.prompt}</Text>
        )}
        <Text style={styles.promptLabel}>{PROMPT_LABELS[question.questionType]}</Text>
      </View>

      <View style={styles.optionsArea}>
        {question.options.map((option, idx) => {
          const isSelected = selectedIndex === idx
          const isCorrect = idx === question.correctIndex
          let optionStyle = {}
          let textStyle = {}
          let iconName: 'checkmark-circle' | 'close-circle' | null = null
          let iconColor: string = colors.textMuted

          if (showFeedback) {
            if (isCorrect) {
              optionStyle = { backgroundColor: colors.success + '22', borderColor: colors.success }
              textStyle = { color: colors.success }
              iconName = 'checkmark-circle'
              iconColor = colors.success
            } else if (isSelected && !isCorrect) {
              optionStyle = { backgroundColor: colors.error + '22', borderColor: colors.error }
              textStyle = { color: colors.error }
              iconName = 'close-circle'
              iconColor = colors.error
            } else {
              optionStyle = { opacity: 0.4 }
            }
          }

          return (
            <TouchableOpacity
              key={idx}
              style={[styles.optionButton, charOpts && styles.optionButtonChar, optionStyle]}
              onPress={() => onSelect(idx)}
              activeOpacity={0.8}
              disabled={showFeedback}
            >
              <Text style={[charOpts ? styles.optionCharText : styles.optionText, textStyle]}>{option}</Text>
              {showFeedback && iconName && !charOpts && (
                <Ionicons name={iconName} size={20} color={iconColor} />
              )}
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg },
  kanjiCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
    position: 'relative',
  },
  jlptBadge: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  jlptText: { ...typography.caption, fontWeight: '700' },
  kanjiCharacter: { ...typography.kanjiDisplay, color: colors.textPrimary, marginTop: spacing.md },
  textPrompt: {
    ...typography.h2,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  promptLabel: { ...typography.bodySmall, color: colors.textMuted, marginTop: spacing.xs },
  optionsArea: { gap: spacing.sm },
  optionButton: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionButtonChar: { justifyContent: 'center', paddingVertical: spacing.lg },
  optionText: { ...typography.body, color: colors.textPrimary, flex: 1 },
  optionCharText: { fontSize: 32, lineHeight: 40, color: colors.textPrimary, textAlign: 'center' },
})
