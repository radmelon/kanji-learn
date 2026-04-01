import { useCallback } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import * as Haptics from 'expo-haptics'
import { colors, spacing, radius, typography } from '../../theme'
import type { ReviewQueueItem } from '@kanji-learn/shared'

interface Props {
  item: ReviewQueueItem
  onReveal: () => void
  isRevealed: boolean
}

const JLPT_COLORS = {
  N5: colors.n5,
  N4: colors.n4,
  N3: colors.n3,
  N2: colors.n2,
  N1: colors.n1,
}

export function CompoundCard({ item, onReveal, isRevealed }: Props) {
  const vocab = item.exampleVocab as { word: string; reading: string; meaning: string }[]
  const jlptColor = JLPT_COLORS[item.jlptLevel as keyof typeof JLPT_COLORS] ?? colors.textMuted

  // Pick a stable featured word per kanji, cycle through vocab on each SRS rep
  const featured = vocab.length > 0 ? vocab[item.kanjiId % vocab.length] : null
  const others = vocab.filter((v) => v !== featured).slice(0, 2)

  const handleReveal = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    onReveal()
  }, [onReveal])

  if (!featured) return null

  return (
    <View style={styles.card}>
      {/* JLPT badge */}
      <View style={[styles.jlptBadge, { backgroundColor: jlptColor + '22', borderColor: jlptColor + '44' }]}>
        <Text style={[styles.jlptText, { color: jlptColor }]}>{item.jlptLevel}</Text>
      </View>

      {/* Compound word */}
      <Text style={styles.compound}>{featured.word}</Text>

      {/* Prompt */}
      <Text style={styles.prompt}>How do you read this word?</Text>

      {!isRevealed ? (
        <TouchableOpacity style={styles.revealButton} onPress={handleReveal} activeOpacity={0.8}>
          <Text style={styles.revealText}>Reveal answer</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.answer}>
          {/* Reading */}
          <Text style={styles.reading}>{featured.reading}</Text>

          {/* Meaning */}
          <Text style={styles.meaning}>{featured.meaning}</Text>

          <View style={styles.divider} />

          {/* Source kanji with its isolated readings */}
          <View style={styles.kanjiContext}>
            <Text style={styles.kanjiChar}>{item.character}</Text>
            <View style={styles.readingPills}>
              {(item.kunReadings as string[]).slice(0, 2).map((r, i) => (
                <View key={`kun${i}`} style={styles.pill}>
                  <Text style={styles.pillLabel}>kun</Text>
                  <Text style={styles.pillValue}>{r}</Text>
                </View>
              ))}
              {(item.onReadings as string[]).slice(0, 2).map((r, i) => (
                <View key={`on${i}`} style={[styles.pill, styles.pillOn]}>
                  <Text style={styles.pillLabel}>on</Text>
                  <Text style={styles.pillValue}>{r}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Other vocab examples */}
          {others.length > 0 && (
            <View style={styles.moreVocab}>
              {others.map((v, i) => (
                <Text key={i} style={styles.vocabItem}>
                  {v.word}【{v.reading}】{v.meaning}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.bgCard,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: spacing.md,
  },
  jlptBadge: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  jlptText: { ...typography.caption, fontWeight: '700' },
  compound: { fontSize: 56, fontWeight: '300', color: colors.textPrimary, letterSpacing: 4 },
  prompt: { ...typography.body, color: colors.textSecondary },
  revealButton: {
    backgroundColor: colors.bgSurface,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  revealText: { ...typography.h3, color: colors.textSecondary },
  answer: { alignItems: 'center', gap: spacing.md, width: '100%' },
  reading: { fontSize: 28, fontWeight: '300', color: colors.primary, letterSpacing: 3 },
  meaning: { ...typography.h2, color: colors.textPrimary, textAlign: 'center' },
  divider: { width: '40%', height: 1, backgroundColor: colors.divider },
  kanjiContext: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    width: '100%',
  },
  kanjiChar: { ...typography.kanjiMedium, color: colors.textSecondary },
  readingPills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, flex: 1 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.bgCard,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillOn: { borderColor: colors.primary + '44' },
  pillLabel: { ...typography.caption, color: colors.textMuted },
  pillValue: { ...typography.caption, color: colors.textPrimary, letterSpacing: 0.5 },
  moreVocab: { gap: 4, width: '100%' },
  vocabItem: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center' },
})
