import { useState, useCallback } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native'
import * as Haptics from 'expo-haptics'
import { colors, spacing, radius, typography } from '../../theme'
import type { ReviewQueueItem } from '@kanji-learn/shared'

interface Props {
  item: ReviewQueueItem
  onReveal: () => void
  isRevealed: boolean
}

export function KanjiCard({ item, onReveal, isRevealed }: Props) {
  const meanings = (item.meanings as string[]).slice(0, 3).join(', ')
  const jlptColor = JLPT_COLORS[item.jlptLevel as keyof typeof JLPT_COLORS] ?? colors.textMuted

  const handleReveal = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    onReveal()
  }, [onReveal])

  return (
    <View style={styles.card}>
      {/* JLPT badge */}
      <View style={[styles.jlptBadge, { backgroundColor: jlptColor + '22', borderColor: jlptColor + '44' }]}>
        <Text style={[styles.jlptText, { color: jlptColor }]}>{item.jlptLevel}</Text>
      </View>

      {/* Kanji character */}
      <Text style={styles.kanji}>{item.character}</Text>

      {/* Review type label */}
      <Text style={styles.prompt}>{PROMPT_LABELS[item.reviewType]}</Text>

      {!isRevealed ? (
        <TouchableOpacity style={styles.revealButton} onPress={handleReveal} activeOpacity={0.8}>
          <Text style={styles.revealText}>Reveal answer</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.answer}>
          {item.reviewType === 'meaning' || item.reviewType === 'compound' ? (
            <Text style={styles.meaningText}>{meanings}</Text>
          ) : null}

          {item.reviewType === 'reading' || item.reviewType === 'compound' ? (
            <View style={styles.readings}>
              {(item.kunReadings as string[]).length > 0 && (
                <View style={styles.readingRow}>
                  <Text style={styles.readingLabel}>kun</Text>
                  <Text style={styles.readingValue}>
                    {(item.kunReadings as string[]).slice(0, 3).join('　')}
                  </Text>
                </View>
              )}
              {(item.onReadings as string[]).length > 0 && (
                <View style={styles.readingRow}>
                  <Text style={styles.readingLabel}>on</Text>
                  <Text style={styles.readingValue}>
                    {(item.onReadings as string[]).slice(0, 3).join('　')}
                  </Text>
                </View>
              )}
            </View>
          ) : null}

          {(item.exampleVocab as any[]).length > 0 && (
            <View style={styles.vocab}>
              {(item.exampleVocab as { word: string; reading: string; meaning: string }[])
                .slice(0, 2)
                .map((v, i) => (
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

const JLPT_COLORS = {
  N5: colors.n5,
  N4: colors.n4,
  N3: colors.n3,
  N2: colors.n2,
  N1: colors.n1,
}

const PROMPT_LABELS = {
  meaning: 'What does this mean?',
  reading: 'How do you read this?',
  writing: 'Write this kanji',
  compound: 'Meaning + all readings',
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
  kanji: { ...typography.kanjiDisplay, color: colors.textPrimary },
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
  meaningText: { ...typography.h2, color: colors.textPrimary, textAlign: 'center' },
  readings: { gap: spacing.sm, width: '100%' },
  readingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  readingLabel: { ...typography.caption, color: colors.textMuted, width: 24, textAlign: 'right' },
  readingValue: { ...typography.reading, color: colors.textPrimary, flex: 1 },
  vocab: { gap: 4, width: '100%' },
  vocabItem: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center' },
})
