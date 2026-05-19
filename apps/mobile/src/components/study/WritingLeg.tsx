import { useState, useCallback } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import type { ReviewQueueItem } from '@kanji-learn/shared'
import { WritingPractice } from '../writing/WritingPractice'
import { colors, spacing, radius, typography } from '../../theme'

interface Props {
  item: ReviewQueueItem
  /** 1-based position of this kanji in the session queue (display only). */
  sessionIndex: number
  sessionTotal: number
  minutesLeft: number | null
  onClose: () => void
  onComplete: () => void
}

/**
 * The writing leg of the Practice Loop. Wraps WritingPractice for one kanji.
 * WritingPractice records its own attempt (POST /v1/review/writing); this
 * wrapper shows the drill and a "Continue" action once a result is in.
 */
export function WritingLeg({ item, sessionIndex, sessionTotal, minutesLeft, onClose, onComplete }: Props) {
  // WritingPractice's canvas PanResponder uses capture-phase; the parent
  // ScrollView must be disabled while drawing or the gesture is stolen.
  const [scrollEnabled, setScrollEnabled] = useState(true)
  const [submitted, setSubmitted] = useState(false)

  const handleDrawingChange = useCallback((isDrawing: boolean) => {
    setScrollEnabled(!isDrawing)
  }, [])

  const handleResult = useCallback(() => {
    setSubmitted(true)
  }, [])

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Ionicons name="close" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.legLabel}>Write it</Text>
        <Text style={styles.counter}>{sessionIndex}/{sessionTotal}</Text>
        {minutesLeft !== null && (
          <Text style={styles.timeLeft}>{minutesLeft}m left</Text>
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={scrollEnabled}
      >
        <WritingPractice
          key={item.kanjiId}
          kanjiId={item.kanjiId}
          character={item.character}
          meanings={item.meanings}
          jlptLevel={item.jlptLevel}
          strokeCount={item.strokeCount}
          kunReadings={item.kunReadings}
          onReadings={item.onReadings}
          index={sessionIndex}
          total={sessionTotal}
          onResult={handleResult}
          onDrawingChange={handleDrawingChange}
        />

        {submitted && (
          <TouchableOpacity style={styles.continueBtn} onPress={onComplete} activeOpacity={0.85}>
            <Text style={styles.continueText}>Continue to speaking</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.sm,
  },
  closeBtn: { padding: spacing.xs },
  legLabel: { ...typography.h3, color: colors.textPrimary, flex: 1 },
  counter: { ...typography.caption, color: colors.textMuted, minWidth: 36, textAlign: 'right' },
  timeLeft: { ...typography.caption, color: colors.textMuted, minWidth: 48, textAlign: 'right' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl },
  continueBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.primary, paddingVertical: spacing.md,
    borderRadius: radius.lg, marginHorizontal: spacing.md, marginTop: spacing.md,
  },
  continueText: { ...typography.h3, color: '#fff' },
})
