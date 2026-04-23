import { useEffect } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, AccessibilityInfo } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, spacing, radius } from '../../theme'
import { TargetChip } from './TargetChip'
import { targetChipMask } from './voiceReveal.logic'

interface Props {
  word: string
  reading: string
  targetKanji: string
  kanjiMeaning: string           // e.g. "finger; point to; indicate"
  vocabMeaning: string           // e.g. "guidance; instruction; coaching"
  isLast: boolean                // true → "Finish session", else "Next Kanji"
  onNext: () => void
}

/**
 * Success render — shown when the learner gets the word correct (any tier).
 * Shows both the kanji's isolated meaning and the vocab word's meaning so
 * the distinction is pedagogically explicit.
 */
export function VoiceSuccessCard({
  word, reading, targetKanji, kanjiMeaning, vocabMeaning, isLast, onNext,
}: Props) {
  useEffect(() => {
    // Announce once on mount — the card is rendered when a correct result
    // arrives and unmounts on advance, so this captures the result exactly.
    AccessibilityInfo.announceForAccessibility(
      `Correct. The word is ${word}, ${reading}. ` +
      `Kanji meaning: ${kanjiMeaning}. Word meaning: ${vocabMeaning}.`
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const mask = targetChipMask(word, targetKanji)

  return (
    <View style={styles.card}>
      <Ionicons name="checkmark-circle" size={40} color={colors.success} style={styles.icon} />
      <Text style={styles.title}>Correct!</Text>

      <Text style={styles.word}>
        {Array.from(word).map((c, i) =>
          mask[i]
            ? <TargetChip key={i}>{c}</TargetChip>
            : <Text key={i}>{c}</Text>
        )}
      </Text>
      <Text style={styles.reading}>{reading}</Text>

      <View style={styles.divider} />

      <Text style={styles.meaningRow}>
        <Text style={styles.meaningLabel}>Kanji ({targetKanji}):</Text>
        <Text>  {kanjiMeaning}</Text>
      </Text>
      <Text style={styles.meaningRow}>
        <Text style={styles.meaningLabel}>Word ({word}):</Text>
        <Text>  {vocabMeaning}</Text>
      </Text>

      <TouchableOpacity
        style={styles.nextBtn}
        onPress={onNext}
        accessibilityHint={isLast ? 'Ends the session' : 'Advances to the next kanji'}
      >
        <Text style={styles.nextBtnText}>{isLast ? 'Finish session' : 'Next kanji'}</Text>
        <Ionicons name={isLast ? 'checkmark' : 'arrow-forward'} size={18} color="#fff" />
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(60, 160, 100, 0.15)',
    borderColor: 'rgba(60, 160, 100, 0.5)',
    borderWidth: 2,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  icon: { marginTop: 4 },
  title: {
    color: colors.success,
    fontWeight: '700',
    fontSize: 16,
    letterSpacing: 1,
  },
  word: {
    fontSize: 48,
    lineHeight: 56,
    marginTop: 8,
    color: colors.textPrimary,   // explicit theme colour (WCAG — no system default)
  },
  reading: {
    fontSize: 20,
    color: colors.textMuted,
    letterSpacing: 2,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignSelf: 'stretch',
    marginVertical: 8,
  },
  meaningRow: {
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 20,
    alignSelf: 'stretch',
  },
  meaningLabel: {
    fontWeight: '600',
    color: colors.accent,
  },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    marginTop: 12,
  },
  nextBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
})
