import { useCallback, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import * as Haptics from 'expo-haptics'
import * as Speech from 'expo-speech'
import { Ionicons } from '@expo/vector-icons'
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

// Japanese TTS options — slightly slower rate aids learning
const SPEECH_OPTS: Speech.SpeechOptions = { language: 'ja-JP', rate: 0.85 }

export function KanjiCard({ item, onReveal, isRevealed, showRomaji, onToggleRomaji }: Props) {
  const meanings = (item.meanings as string[]).join(', ')
  const jlptColor = JLPT_COLORS[item.jlptLevel as keyof typeof JLPT_COLORS] ?? colors.textMuted

  // Which group is currently being spoken: null | 'kun' | 'on' | vocab index
  const [speakingGroup, setSpeakingGroup] = useState<string | null>(null)

  const hasReadings =
    item.reviewType === 'reading' || item.reviewType === 'compound'
  const kunReadings = item.kunReadings as string[]
  const onReadings = item.onReadings as string[]
  const exampleVocab = item.exampleVocab as { word: string; reading: string; meaning: string }[]

  const handleReveal = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    onReveal()
  }, [onReveal])

  /** Speak a list of kana in sequence, updating speakingGroup for visual feedback. */
  const speakSequence = useCallback((
    words: string[],
    groupKey: string,
    stripDot = false,
  ) => {
    // Stop any current speech if this group is already active
    if (speakingGroup === groupKey) {
      Speech.stop()
      setSpeakingGroup(null)
      return
    }
    Speech.stop()
    setSpeakingGroup(groupKey)

    const cleaned = words.map((w) => (stripDot ? w.replace('.', '') : w))

    const speakAt = (idx: number) => {
      if (idx >= cleaned.length) {
        setSpeakingGroup(null)
        return
      }
      Speech.speak(cleaned[idx], {
        ...SPEECH_OPTS,
        onDone: () => speakAt(idx + 1),
        onError: () => { setSpeakingGroup(null) },
      })
    }
    speakAt(0)
  }, [speakingGroup])

  /** Speak a single vocab word by its reading. */
  const speakVocab = useCallback((reading: string, key: string) => {
    if (speakingGroup === key) {
      Speech.stop()
      setSpeakingGroup(null)
      return
    }
    Speech.stop()
    setSpeakingGroup(key)
    Speech.speak(reading, {
      ...SPEECH_OPTS,
      onDone: () => setSpeakingGroup(null),
      onError: () => setSpeakingGroup(null),
    })
  }, [speakingGroup])

  return (
    <View style={styles.card}>
      {/* JLPT badge — top right */}
      <View style={[styles.jlptBadge, { backgroundColor: jlptColor + '22', borderColor: jlptColor + '44' }]}>
        <Text style={[styles.jlptText, { color: jlptColor }]}>{item.jlptLevel}</Text>
      </View>

      {/* Rōmaji toggle — top left, only on reading/compound cards */}
      {hasReadings && (
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
      )}

      {/* Kanji character — always visible, centred in upper half */}
      <View style={styles.kanjiArea}>
        <Text style={styles.kanji}>{item.character}</Text>
        <Text style={styles.prompt}>{PROMPT_LABELS[item.reviewType as keyof typeof PROMPT_LABELS]}</Text>
      </View>

      {!isRevealed ? (
        <TouchableOpacity style={styles.revealButton} onPress={handleReveal} activeOpacity={0.8}>
          <Text style={styles.revealText}>Reveal answer</Text>
        </TouchableOpacity>
      ) : (
        /* Scrollable answer area so long content (readings + vocab + references) never gets clipped */
        <ScrollView
          style={styles.answerScroll}
          contentContainerStyle={styles.answer}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >

          {/* Meanings (all, not capped) */}
          {(item.reviewType === 'meaning' || item.reviewType === 'compound') && (
            <Text style={styles.meaningText}>{meanings}</Text>
          )}

          {/* Readings with speaker buttons */}
          {hasReadings && (
            <View style={styles.readingsBlock}>

              {/* Kun readings */}
              {kunReadings.length > 0 && (
                <View style={styles.readingRow}>
                  <Text style={styles.readingLabel}>kun</Text>
                  <View style={styles.readingGroup}>
                    <Text style={styles.readingKana}>{kunReadings.join('　')}</Text>
                    {showRomaji && (
                      <Text style={styles.readingRomaji}>
                        {kunReadings.map((r) => toRomaji(r.replace('.', ''))).join('　')}
                      </Text>
                    )}
                  </View>
                  <SpeakButton
                    groupKey="kun"
                    speakingGroup={speakingGroup}
                    onPress={() => speakSequence(kunReadings, 'kun', true)}
                  />
                </View>
              )}

              {/* On readings */}
              {onReadings.length > 0 && (
                <View style={styles.readingRow}>
                  <Text style={styles.readingLabel}>on</Text>
                  <View style={styles.readingGroup}>
                    <Text style={styles.readingKana}>{onReadings.join('　')}</Text>
                    {showRomaji && (
                      <Text style={styles.readingRomaji}>
                        {onReadings.map((r) => toRomaji(r)).join('　')}
                      </Text>
                    )}
                  </View>
                  <SpeakButton
                    groupKey="on"
                    speakingGroup={speakingGroup}
                    onPress={() => speakSequence(onReadings, 'on')}
                  />
                </View>
              )}
            </View>
          )}

          {/* Example vocab — tappable to hear pronunciation */}
          {exampleVocab.length > 0 && (
            <View style={styles.vocab}>
              {exampleVocab.slice(0, 2).map((v, i) => {
                const key = `vocab-${i}`
                const isActive = speakingGroup === key
                return (
                  <TouchableOpacity
                    key={i}
                    style={[styles.vocabRow, isActive && styles.vocabRowActive]}
                    onPress={() => speakVocab(v.reading, key)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={isActive ? 'volume-high' : 'volume-medium-outline'}
                      size={13}
                      color={isActive ? colors.accent : colors.textMuted}
                      style={{ marginTop: 1 }}
                    />
                    <Text style={styles.vocabItem}>
                      {v.word}【{v.reading}】{v.meaning}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          )}

          {/* References panel */}
          <ReferencesPanel item={item} />
        </ScrollView>
      )}
    </View>
  )
}

// ─── SpeakButton ──────────────────────────────────────────────────────────────

function SpeakButton({
  groupKey,
  speakingGroup,
  onPress,
}: {
  groupKey: string
  speakingGroup: string | null
  onPress: () => void
}) {
  const isActive = speakingGroup === groupKey
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      activeOpacity={0.7}
      style={[styles.speakBtn, isActive && styles.speakBtnActive]}
    >
      <Ionicons
        name={isActive ? 'volume-high' : 'volume-medium-outline'}
        size={16}
        color={isActive ? colors.accent : colors.textMuted}
      />
    </TouchableOpacity>
  )
}

// ─── ReferencesPanel ─────────────────────────────────────────────────────────

function ReferencesPanel({ item }: { item: ReviewQueueItem }) {
  const [open, setOpen] = useState(false)

  const radicals = (item.radicals as string[] | undefined) ?? []
  const strokes = item.strokeCount as number | null | undefined
  const nelsonC = item.nelsonClassic as number | null | undefined
  const nelsonN = item.nelsonNew as number | null | undefined
  const morIndex = item.morohashiIndex as number | null | undefined
  const morVol = item.morohashiVolume as number | null | undefined
  const morPage = item.morohashiPage as number | null | undefined

  const morohashi = morIndex != null
    ? morVol != null && morPage != null
      ? `${morIndex} (vol. ${morVol}, p. ${morPage})`
      : `${morIndex}`
    : null

  // Whether the API has sent us enriched data (fresh session, not cached)
  const hasData = strokes != null || radicals.length > 0 || nelsonC != null || nelsonN != null || morohashi != null

  // Always render the toggle — never return null so the panel is always discoverable.
  // (On cached sessions the fields will be undefined; the expanded body explains this.)
  return (
    <View style={refStyles.container}>
      <TouchableOpacity
        style={refStyles.toggle}
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="book-outline" size={13} color={colors.textMuted} />
        <Text style={refStyles.toggleLabel}>References</Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={13}
          color={colors.textMuted}
        />
      </TouchableOpacity>

      {open && (
        <View style={refStyles.body}>
          {!hasData ? (
            <Text style={refStyles.noData}>
              Reference data (stroke count, radicals, Nelson IDs) loads on your next fresh session.
            </Text>
          ) : (
            <>
              {strokes != null && (
                <RefRow icon="pencil-outline" label="Strokes" value={String(strokes)} />
              )}
              {radicals.length > 0 && (
                <RefRow icon="grid-outline" label="Radicals" value={radicals.join('　')} />
              )}
              {nelsonC != null && (
                <RefRow icon="book-outline" label="Nelson Classic" value={`#${nelsonC}`} />
              )}
              {nelsonN != null && (
                <RefRow icon="book-outline" label="New Nelson" value={`#${nelsonN}`} />
              )}
              {morohashi != null && (
                <RefRow icon="library-outline" label="Morohashi" value={morohashi} />
              )}
              <Text style={refStyles.credit}>
                Nelson: Andrew Nelson, "The Modern Reader's Japanese-English Character
                Dictionary" (Classic 1962); Jack Halpern ed. (New Nelson, 1997).{'\n'}
                Morohashi: Tetsuji Morohashi, "Dai Kan-Wa Jiten" (大漢和辞典), 1955–1960.
              </Text>
            </>
          )}
        </View>
      )}
    </View>
  )
}

function RefRow({ icon, label, value }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: string }) {
  return (
    <View style={refStyles.row}>
      <Ionicons name={icon} size={12} color={colors.textMuted} style={refStyles.rowIcon} />
      <Text style={refStyles.rowLabel}>{label}</Text>
      <Text style={refStyles.rowValue}>{value}</Text>
    </View>
  )
}

const refStyles = StyleSheet.create({
  container: { width: '100%', marginTop: spacing.xs },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: spacing.xs,
  },
  toggleLabel: { ...typography.caption, color: colors.textMuted },
  body: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  rowIcon: { width: 16 },
  rowLabel: { ...typography.caption, color: colors.textMuted, width: 96 },
  rowValue: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  noData: { ...typography.caption, color: colors.textMuted, fontStyle: 'italic', lineHeight: 18 },
  credit: {
    ...typography.caption,
    color: colors.textMuted,
    fontStyle: 'italic',
    lineHeight: 16,
    marginTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: spacing.xs,
  },
})

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
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: spacing.md,
    overflow: 'hidden',
    // No padding here — handled by inner sections
  },
  // Upper section: kanji + prompt, vertically centred
  kanjiArea: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
    minHeight: 180,
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

  // Rōmaji toggle — top-left corner
  romajiToggle: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
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

  kanji: { ...typography.kanjiDisplay, color: colors.textPrimary },
  prompt: { ...typography.body, color: colors.textSecondary },
  revealButton: {
    backgroundColor: colors.bgSurface,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.xl,
  },
  revealText: { ...typography.h3, color: colors.textSecondary },
  // Scrollable container for the full answer (readings, vocab, references)
  answerScroll: { flex: 1 },
  answer: {
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  meaningText: { ...typography.h2, color: colors.textPrimary, textAlign: 'center' },

  // Readings block
  readingsBlock: { width: '100%', gap: spacing.xs },
  readingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  readingLabel: {
    ...typography.caption,
    color: colors.textMuted,
    width: 24,
    textAlign: 'right',
    paddingTop: 2,
  },
  readingGroup: { flex: 1, gap: 2 },
  readingKana: { ...typography.reading, color: colors.textPrimary, flexWrap: 'wrap' },
  readingRomaji: { ...typography.caption, color: colors.textSecondary, flexWrap: 'wrap' },

  // Speaker button
  speakBtn: {
    padding: 4,
    borderRadius: radius.full,
  },
  speakBtnActive: {
    backgroundColor: colors.accent + '22',
  },

  // Vocab examples
  vocab: { gap: 6, width: '100%' },
  vocabRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    paddingVertical: 3,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
  },
  vocabRowActive: {
    backgroundColor: colors.accent + '11',
  },
  vocabItem: { ...typography.bodySmall, color: colors.textSecondary, flex: 1 },
})
