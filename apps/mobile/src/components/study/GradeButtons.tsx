import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable } from 'react-native'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { isGradeAllowedAfterHint } from '@kanji-learn/shared'
import { colors, spacing, radius, typography } from '../../theme'

interface Props {
  onGrade: (quality: 0 | 1 | 2 | 3 | 4 | 5) => void
  /** When true, Good and Easy are disabled — a hinted recall is "recalled with
   *  difficulty", which is exactly what Hard means (design spec §8.2). */
  hintUsed?: boolean
}

const GRADES = [
  { quality: 1 as const, grade: 'again' as const, label: 'Again', sublabel: 'Total blank', color: colors.error },
  { quality: 3 as const, grade: 'hard' as const, label: 'Hard', sublabel: 'Struggled', color: colors.warning },
  { quality: 4 as const, grade: 'good' as const, label: 'Good', sublabel: 'Correct', color: colors.success },
  { quality: 5 as const, grade: 'easy' as const, label: 'Easy', sublabel: 'Perfect', color: colors.accent },
]

// B-228: these described an SM-2 ease factor and a hard reset to day 1. The
// scheduler is FSRS (packages/shared/src/srs.ts) — it has no ease factor, and a
// lapse shrinks stability proportionally, capped at the pre-lapse value, never
// to day 1. Each description below states what `calculateNextReview` does for
// that rating: `ratingFromQuality` maps quality 1→Again, 3→Hard, 4→Good, 5→Easy.
const GRADE_HELP = [
  {
    quality: 1,
    label: 'Again',
    color: colors.error,
    description: 'Complete blank — you couldn\'t recall anything. Stability shrinks and the card gets marked harder, but it is not reset to day 1: the drop is proportional, so a kanji you had held for months still comes back later than a brand-new one.',
  },
  {
    quality: 3,
    label: 'Hard',
    color: colors.warning,
    description: 'You recalled it, but with real difficulty. Stability still grows — just less than Good would give it — and the card gets marked harder, so its intervals open up more slowly from here.',
  },
  {
    quality: 4,
    label: 'Good',
    color: colors.success,
    description: 'Correct with some effort. Stability grows by the standard amount and the card\'s difficulty holds roughly steady — this is the most common answer.',
  },
  {
    quality: 5,
    label: 'Easy',
    color: colors.accent,
    description: 'Perfect, instant recall. Stability grows the most and the card gets marked easier, pushing the next review furthest out.',
  },
]

export function GradeButtons({ onGrade, hintUsed = false }: Props) {
  const [showHelp, setShowHelp] = useState(false)

  const handlePress = (quality: 0 | 1 | 2 | 3 | 4 | 5) => {
    const style =
      quality <= 1
        ? Haptics.ImpactFeedbackStyle.Heavy
        : quality >= 4
        ? Haptics.ImpactFeedbackStyle.Light
        : Haptics.ImpactFeedbackStyle.Medium
    Haptics.impactAsync(style)
    onGrade(quality)
  }

  return (
    <>
      <View style={styles.wrapper}>
        <View style={styles.container}>
          {GRADES.map(({ quality, grade, label, sublabel, color }) => {
            const allowed = isGradeAllowedAfterHint(grade, hintUsed)
            return (
              <TouchableOpacity
                key={quality}
                style={[styles.button, { borderColor: color + '55' }, !allowed && styles.buttonDisabled]}
                onPress={() => handlePress(quality)}
                activeOpacity={0.75}
                disabled={!allowed}
              >
                <View style={[styles.indicator, { backgroundColor: color }]} />
                <Text style={[styles.label, { color }]}>{label}</Text>
                {/* The sublabel carries the reason. A greyed button with no
                    explanation reads as a bug, not a rule. */}
                <Text style={styles.sublabel}>{allowed ? sublabel : 'Hint used'}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
        <TouchableOpacity style={styles.helpBtn} onPress={() => setShowHelp(true)} hitSlop={8}>
          <Ionicons name="information-circle-outline" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <Modal visible={showHelp} transparent animationType="fade" onRequestClose={() => setShowHelp(false)}>
        <Pressable style={styles.backdrop} onPress={() => setShowHelp(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Grade Buttons</Text>
              <TouchableOpacity onPress={() => setShowHelp(false)} hitSlop={8}>
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.sheetIntro}>
              After revealing a card, rate how well you recalled it. FSRS tracks two numbers per card — how long the memory should last, and how hard the card is for you — and your answer moves both, which sets when the card comes back.
            </Text>
            {GRADE_HELP.map(({ quality, label, color, description }) => (
              <View key={quality} style={styles.helpRow}>
                <View style={[styles.helpDot, { backgroundColor: color }]} />
                <View style={styles.helpTextCol}>
                  <Text style={[styles.helpLabel, { color }]}>{label}</Text>
                  <Text style={styles.helpDesc}>{description}</Text>
                </View>
              </View>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
  },
  container: { flex: 1, flexDirection: 'row', gap: spacing.xs },
  button: {
    flex: 1,
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    gap: 2,
  },
  buttonDisabled: { opacity: 0.35 },
  indicator: { width: 24, height: 4, borderRadius: radius.full, marginBottom: 4 },
  label: { ...typography.bodySmall, fontWeight: '700' },
  sublabel: { ...typography.caption, color: colors.textMuted },
  helpBtn: { padding: spacing.xs },

  // Modal
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bgCard,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sheetTitle: { ...typography.h3, color: colors.textPrimary },
  sheetIntro: { ...typography.bodySmall, color: colors.textSecondary, lineHeight: 20 },
  helpRow: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  helpDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
  },
  helpTextCol: { flex: 1, gap: 2 },
  helpLabel: { ...typography.body, fontWeight: '700' },
  helpDesc: { ...typography.bodySmall, color: colors.textSecondary, lineHeight: 20 },
})
