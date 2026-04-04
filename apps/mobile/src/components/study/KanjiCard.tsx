import { useCallback } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import * as Haptics from 'expo-haptics'
import { toRomaji } from 'wanakana'
import { colors, spacing, radius, typography } from '../../theme'
import type { ReviewQueueItem } from '@kanji-learn/shared'

interface Props {
  item: ReviewQueueItem
  onReveal: () => void
  isRevealed: boolean
  /** Whether to show romaji transliterations below each reading (session-level toggle) */
  showRomaji: boolean
  onToggleRomaji: () => void
}

export function KanjiCard({ item, onReveal, isRevealed, showRomaji, onToggleRomaji }: Props) {
  const meanings = (item.meanings as string[]).join(', ')
  const jlptColor = JLPT_COLORS[item.jlptLevel as keyof typeof JLPT_COLORS] ?? colors.textMuted

  const handleReveal = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    onReveal()
  }, [onReveal])

  const hasReadings =
    item.reviewType === 'reading' || item.reviewType === 'compound'
  const kunReadings = item.kunReadings as string[]
  const onReadings = item.onReadings as string[]

  return (
    <View style={styles.card}>
      {/* JLPT badge */}
      <View style={[styles.jlptBadge, { backgroundColor: jlptColor + '22', borderColor: jlptColor + '44' }]}>
        <Text style={[styles.jlptText, { color: jlptColor }]}>{item.jlptLevel}</Text>
      </View>

      {/* Kanji character */}
      <Text style={styles.kanji}>{item.character}</Text>

      {/* Review type label */}
      <Text style={styles.prompt}>{PROMPT_LABELS[item.reviewType as keyof typeof PROMPT_LABELS]}</Text>

      {!isRevealed ? (
        <TouchableOpacity style={styles.revealButton} onPress={handleReveal} activeOpacity={0.8}>
          <Text style={styles.revealText}>Reveal answer</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.answer}>

          {/* Meanings (all, not capped) */}
          {(item.reviewType === 'meaning' || item.reviewType === 'compound') && (
            <Text style={styles.meaningText}>{meanings}</Text>
          )}

          {/* Readings */}
          {hasReadings && (
            <View style={styles.readingsBlock}>
              {/* Toggle row */}
              <View style={styles.readingsHeader}>
                <Text style={styles.readingsSectionLabel}>Readings</Text>
                <TouchableOpacity
                  onPress={onToggleRomaji}
                  style={[styles.romajiToggle, showRomaji && styles.romajiToggleActive]}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={[styles.romajiToggleText, showRomaji && styles.romajiToggleTextActive]}>
                    Rōmaji
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Kun readings */}
              {kunReadings.length > 0 && (
                <View style={styles.readingRow}>
                  <Text style={styles.readingLabel}>kun</Text>
                  <View style={styles.readingGroup}>
                    <Text style={styles.readingKana}>
                      {kunReadings.join('　')}
                    </Text>
                    {showRomaji && (
                      <Text style={styles.readingRomaji}>
                        {kunReadings.map((r) => toRomaji(r.replace('.', ''))).join('　')}
                      </Text>
                    )}
                  </View>
                </View>
              )}

              {/* On readings */}
              {onReadings.length > 0 && (
                <View style={styles.readingRow}>
                  <Text style={styles.readingLabel}>on</Text>
                  <View style={styles.readingGroup}>
                    <Text style={styles.readingKana}>
                      {onReadings.join('　')}
                    </Text>
                    {showRomaji && (
                      <Text style={styles.readingRomaji}>
                        {onReadings.map((r) => toRomaji(r)).join('　')}
                      </Text>
                    )}
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Example vocab */}
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

// ─── Constants ────────────────────────────────────────────────────────────────

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

// ─── Styles ───────────────────────────────────────────────────────────────────

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

  // Readings block
  readingsBlock: { width: '100%', gap: spacing.xs },
  readingsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  readingsSectionLabel: { ...typography.caption, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Rōmaji toggle pill
  romajiToggle: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSurface,
  },
  romajiToggleActive: {
    borderColor: colors.info,
    backgroundColor: colors.info + '22',
  },
  romajiToggleText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  romajiToggleTextActive: { color: colors.info },

  // Per-type reading rows
  readingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  readingLabel: {
    ...typography.caption,
    color: colors.textMuted,
    width: 24,
    textAlign: 'right',
    paddingTop: 2, // align with first line of kana
  },
  readingGroup: { flex: 1, gap: 2 },
  readingKana: { ...typography.reading, color: colors.textPrimary, flexWrap: 'wrap' },
  readingRomaji: { ...typography.caption, color: colors.textSecondary, flexWrap: 'wrap' },

  // Vocab examples
  vocab: { gap: 4, width: '100%' },
  vocabItem: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center' },
})
