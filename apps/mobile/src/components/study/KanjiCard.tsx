// KanjiCard.tsx
// Flip card shown during a study session for meaning/reading/writing reviews.
//
// TTS notes (build 76):
//   - Audio session setup (playsInSilentModeIOS) is intentionally NOT done here.
//     It lives in _layout.tsx and is refreshed on every app foreground. Calling
//     Audio.setAudioModeAsync from KanjiCard caused expo-av v16 instability
//     because the component mounts/unmounts repeatedly in weak-spots queues.
//   - isMountedRef + Speech.stop() on unmount guard against post-unmount callbacks
//     that would crash when the card type changes (KanjiCard ↔ CompoundCard).

import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Animated, Linking, Modal, SafeAreaView } from 'react-native'
import * as Haptics from 'expo-haptics'
import * as Speech from 'expo-speech'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { toRomaji } from 'wanakana'
import { colors, spacing, radius, typography } from '../../theme'
import type { ReviewQueueItem } from '@kanji-learn/shared'
import { PitchAccentReading } from '../kanji/PitchAccentReading'
import { useShowPitchAccent } from '../../hooks/useShowPitchAccent'
import { StrokeOrderAnimation } from '../writing/StrokeOrderAnimation'
import { getRadicalName } from '../../constants/radicals'

/** Render a Japanese sentence with the target vocab word highlighted in accent color. */
function highlightVocab(sentence: string, vocab: string): React.ReactNode {
  const idx = sentence.indexOf(vocab)
  if (idx === -1) return <Text style={sentenceJaText}>{sentence}</Text>
  return (
    <>
      <Text style={sentenceJaText}>{sentence.slice(0, idx)}</Text>
      <Text style={[sentenceJaText, sentenceHighlight]}>{vocab}</Text>
      <Text style={sentenceJaText}>{sentence.slice(idx + vocab.length)}</Text>
    </>
  )
}

// Hoisted style refs used inside highlightVocab (plain objects, not StyleSheet entries)
const sentenceJaText = { fontSize: 15, color: colors.textPrimary } as const
const sentenceHighlight = { color: colors.accent, fontWeight: '700' as const }


interface Props {
  item: ReviewQueueItem
  onReveal: () => void
  isRevealed: boolean
  /** Whether to show romaji transliterations below each reading (session-level toggle) */
  showRomaji: boolean
  onToggleRomaji: () => void
  /** Called whenever the full-details drawer opens or closes — lets the parent
   *  PanResponder yield gestures while the drawer is visible. */
  onDetailsOpenChange?: (open: boolean) => void
}

// Japanese TTS options — slightly slower rate aids learning
const SPEECH_OPTS: Speech.SpeechOptions = { language: 'ja-JP', rate: 0.85 }

export function KanjiCard({ item, onReveal, isRevealed, showRomaji, onToggleRomaji, onDetailsOpenChange }: Props) {
  const router = useRouter()
  // Array.isArray() guards protect against non-array truthy values (e.g. a string
  // stored as jsonb in the DB). `?? []` only catches null/undefined — a string
  // passes through and calling .map()/.join() on it gives "undefined is not a function".
  const meanings = (Array.isArray(item.meanings) ? item.meanings : []).join(', ')
  const jlptColor = JLPT_COLORS[item.jlptLevel as keyof typeof JLPT_COLORS] ?? colors.textMuted
  const exampleVocab = (Array.isArray(item.exampleVocab)
    ? item.exampleVocab as { word: string; reading: string; meaning: string; pitchPattern?: number[] }[]
    : []).slice(0, 2)
  const [showPitchAccent] = useShowPitchAccent()

  // Which group is currently being spoken: null | 'kun' | 'on' | vocab index
  const [speakingGroup, setSpeakingGroup] = useState<string | null>(null)
  const iconOpacity = useRef(new Animated.Value(0)).current

  // Guard TTS callbacks against post-unmount execution.
  //
  // KanjiCard unmounts whenever the queue advances to a compound card (and vice
  // versa). Without this guard, a speakSequence onDone callback scheduled by the
  // previous card would fire into the now-unmounted component, triggering either
  // a setState-on-unmounted-component warning or, in expo-av v16, an RCTFatal
  // native crash. Speech.stop() in the cleanup cancels the native utterance so
  // the callback never fires; isMountedRef provides a second layer of defence
  // for any callbacks that have already been scheduled before stop() takes effect.
  // Reset speaking state when the card changes (kanjiId changes) without unmounting.
  // KanjiCard stays mounted across same-type card advances to avoid calling
  // Speech.stop() in the cleanup on every grade press (crashes native speech bridge).
  useEffect(() => {
    setSpeakingGroup(null)
  }, [item.kanjiId])

  // Fade the magnifying glass icon in when the card is revealed, out on reset
  useEffect(() => {
    Animated.timing(iconOpacity, {
      toValue: isRevealed ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start()
  }, [isRevealed, iconOpacity])

  const isMountedRef = useRef(true)
  // Holds the currently-running flip animation so we can stop it on unmount.
  // Without this, Part 2 of the flip (useNativeDriver:true) can outlive the
  // component and crash the native animation thread when its node is destroyed.
  const activeFlipRef = useRef<Animated.CompositeAnimation | null>(null)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      activeFlipRef.current?.stop()   // cancel any in-flight native flip animation
      Speech.stop()
    }
  }, [])

  // 3D flip animation — rotates through 90° (disappear) → swap content → 90° (reappear)
  const flipAnim = useRef(new Animated.Value(0)).current
  const rotateY = flipAnim.interpolate({
    inputRange: [-90, 0, 90],
    outputRange: ['-90deg', '0deg', '90deg'],
  })

  // Show readings on ALL card types after reveal — even meaning cards benefit
  // from seeing the on/kun alongside the meaning
  const hasReadings = true
  // Null-coalesce all array fields — some kanji (e.g. kokuji with no on'yomi,
  // or kanji with no kun'yomi) may have null in the DB. Without this, accessing
  // .length on null throws a JS TypeError that RN reports as RCTFatal.
  const kunReadings = Array.isArray(item.kunReadings) ? item.kunReadings as string[] : []
  const onReadings = Array.isArray(item.onReadings) ? item.onReadings as string[] : []

  const handleReveal = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)

    // Part 1: rotate to 90° (card disappears edge-on)
    const part1 = Animated.timing(flipAnim, { toValue: 90, duration: 180, useNativeDriver: true })
    activeFlipRef.current = part1
    part1.start(() => {
      // Clear the ref as soon as part1 finishes so the cleanup effect's
      // activeFlipRef.current?.stop() call is a no-op if no animation is
      // in flight. Calling stopAnimation() on an already-completed native
      // animation frees its ID, causing an RCTFatal in RN 0.81.
      activeFlipRef.current = null

      // Guard: if the component unmounted while part1 was running bail out —
      // starting part2 on a destroyed native node also causes RCTFatal.
      if (!isMountedRef.current) return

      onReveal()             // swap content at the midpoint
      flipAnim.setValue(-90) // jump to the other side, still edge-on

      // Part 2: rotate back to 0° (answer side comes into view)
      const part2 = Animated.timing(flipAnim, { toValue: 0, duration: 180, useNativeDriver: true })
      activeFlipRef.current = part2
      part2.start(() => {
        activeFlipRef.current = null  // clear when done — same reason as above
      })
    })
  }, [onReveal, flipAnim])

  /** Speak a list of kana in sequence, updating speakingGroup for visual feedback. */
  const speakSequence = useCallback((
    words: string[],
    groupKey: string,
    stripDot = false,
  ) => {
    // Toggle off if this group is already active
    if (speakingGroup === groupKey) {
      Speech.stop()
      setSpeakingGroup(null)
      return
    }
    // Only stop if something is actually playing. Calling Speech.stop() on an
    // idle synthesizer briefly puts iOS into a "stopping" state; starting a new
    // utterance immediately after causes it to be silently dropped.
    if (speakingGroup !== null) Speech.stop()
    setSpeakingGroup(groupKey)

    const cleaned = words.map((w) => (stripDot ? w.replace('.', '') : w))

    const speakAt = (idx: number) => {
      if (!isMountedRef.current || idx >= cleaned.length) {
        if (isMountedRef.current) setSpeakingGroup(null)
        return
      }
      Speech.speak(cleaned[idx], {
        ...SPEECH_OPTS,
        onDone: () => speakAt(idx + 1),
        onError: (e) => {
          console.error('[TTS] speakSequence error for', cleaned[idx], e)
          if (isMountedRef.current) setSpeakingGroup(null)
        },
      })
    }
    speakAt(0)
  }, [speakingGroup])

  // Visual cue distinguishing meaning vs reading prompts. Writing/compound stay neutral.
  const cueColor =
    item.reviewType === 'meaning' ? colors.meaningCue :
    item.reviewType === 'reading' ? colors.accent :
    null
  const cueTint = cueColor ? `${cueColor}14` : 'transparent' // ~8% opacity

  return (
    <Animated.View style={[styles.card, { transform: [{ perspective: 1200 }, { rotateY }] }]}>
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
      <View
        style={[
          styles.kanjiArea,
          cueColor && {
            borderWidth: 2,
            borderColor: cueColor,
            backgroundColor: cueTint,
            borderRadius: radius.lg,
          },
        ]}
      >
        <Text style={styles.kanji}>{item.character}</Text>
        <Text style={styles.prompt}>{PROMPT_LABELS[item.reviewType as keyof typeof PROMPT_LABELS]}</Text>
        {/* Full Details icon — fades in on reveal, bottom-left of kanji area */}
        <Animated.View style={[styles.detailsIcon, { opacity: iconOpacity }]} pointerEvents={isRevealed ? 'auto' : 'none'}>
          <TouchableOpacity
            onPress={() => router.push(`/kanji/${item.kanjiId}`)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
          >
            <Ionicons name="search" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </Animated.View>
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

          {/* Example vocab — first 2 entries */}
          {exampleVocab.length > 0 && (
            <View style={styles.vocab}>
              {exampleVocab.map((v, i) => (
                <View key={i} style={styles.vocabRow}>
                  <Text style={styles.vocabItem}>{v.word}【</Text>
                  <PitchAccentReading
                    reading={v.reading}
                    pattern={v.pitchPattern}
                    enabled={showPitchAccent}
                    size="small"
                  />
                  <Text style={styles.vocabItem}>】{'  '}{v.meaning}</Text>
                </View>
              ))}
            </View>
          )}

        </ScrollView>
      )}

      {/* The magnifying glass icon now navigates to /kanji/:id (the canonical
          details page, reused from Browse). The old RevealAllDrawer modal was
          a second details surface that drifted out of sync with the main page
          — e.g. missing the mnemonic section added in B121. Consolidating to
          one source of truth (2026-04-19). The drawer code remains below for
          now and can be deleted in a follow-up cleanup pass. */}
    </Animated.View>
  )
}

// ─── RevealAllDrawer ──────────────────────────────────────────────────────────

function RevealAllDrawer({ item, visible, onClose }: { item: ReviewQueueItem; visible: boolean; onClose: () => void }) {
  const jlptColor = JLPT_COLORS[item.jlptLevel as keyof typeof JLPT_COLORS] ?? colors.textMuted
  // Array.isArray() is required here — `?? []` only catches null/undefined, but if a
  // field arrives as a non-array truthy value (e.g. a string stored as jsonb), the
  // `??` passes it through and calling .map()/.join() throws "undefined is not a function".
  const meanings = Array.isArray(item.meanings) ? item.meanings as string[] : []
  const kunReadings = Array.isArray(item.kunReadings) ? item.kunReadings as string[] : []
  const onReadings = Array.isArray(item.onReadings) ? item.onReadings as string[] : []
  const exampleVocab = Array.isArray(item.exampleVocab) ? item.exampleVocab as { word: string; reading: string; meaning: string }[] : []
  const exampleSentences = Array.isArray(item.exampleSentences) ? item.exampleSentences as { ja: string; en: string; vocab: string }[] : []
  const radicals = Array.isArray(item.radicals) ? item.radicals as string[] : []
  const strokes = item.strokeCount as number | null | undefined
  const nelsonC = item.nelsonClassic as number | null | undefined
  const nelsonN = item.nelsonNew as number | null | undefined
  const morIndex = item.morohashiIndex as number | null | undefined
  const morVol = item.morohashiVolume as number | null | undefined
  const morPage = item.morohashiPage as number | null | undefined
  const morohashi = morIndex != null
    ? morVol != null && morPage != null ? `${morIndex} (vol. ${morVol}, p. ${morPage})` : `${morIndex}`
    : null

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={drawerStyles.safe}>
        {/* Header */}
        <View style={drawerStyles.header}>
          <View style={[drawerStyles.jlptBadge, { backgroundColor: jlptColor + '22', borderColor: jlptColor + '55' }]}>
            <Text style={[drawerStyles.jlptText, { color: jlptColor }]}>{item.jlptLevel}</Text>
          </View>
          <Text style={drawerStyles.character}>{item.character}</Text>
          <TouchableOpacity onPress={onClose} style={drawerStyles.closeBtn}>
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={drawerStyles.body} showsVerticalScrollIndicator={false}>

          {/* Meanings */}
          <DrawerSection title="Meanings">
            {meanings.map((m, i) => (
              <Text key={i} style={drawerStyles.meaningRow}>
                <Text style={drawerStyles.meaningIndex}>{i + 1}. </Text>{m}
              </Text>
            ))}
          </DrawerSection>

          {/* Readings */}
          {(kunReadings.length > 0 || onReadings.length > 0) && (
            <DrawerSection title="Readings">
              {kunReadings.length > 0 && (
                <View style={drawerStyles.readingRow}>
                  <Text style={drawerStyles.readingLabel}>kun</Text>
                  <Text style={drawerStyles.readingValue}>{kunReadings.join('　')}</Text>
                </View>
              )}
              {onReadings.length > 0 && (
                <View style={drawerStyles.readingRow}>
                  <Text style={drawerStyles.readingLabel}>on</Text>
                  <Text style={drawerStyles.readingValue}>{onReadings.join('　')}</Text>
                </View>
              )}
            </DrawerSection>
          )}

          {/* Radicals */}
          {radicals.length > 0 && (
            <DrawerSection title="Radicals">
              <View style={drawerStyles.radicalGrid}>
                {radicals.map((r, i) => {
                  const name = getRadicalName(r)
                  return (
                    <View key={i} style={drawerStyles.radicalPill}>
                      <Text style={drawerStyles.radicalChar}>{r}</Text>
                      {name ? <Text style={drawerStyles.radicalName}>{name}</Text> : null}
                    </View>
                  )
                })}
              </View>
            </DrawerSection>
          )}

          {/* Example Vocab */}
          {exampleVocab.length > 0 && (
            <DrawerSection title="Example Vocabulary">
              {exampleVocab.map((v, i) => (
                <View key={i} style={drawerStyles.vocabRow}>
                  <Text style={drawerStyles.vocabWord}>{v.word}</Text>
                  <Text style={drawerStyles.vocabReading}>【{v.reading}】</Text>
                  <Text style={drawerStyles.vocabMeaning}>{v.meaning}</Text>
                </View>
              ))}
            </DrawerSection>
          )}

          {/* Example Sentences */}
          {exampleSentences.length > 0 && (
            <DrawerSection title="Example Sentences">
              {exampleSentences.map((s, i) => (
                <View key={i} style={drawerStyles.sentenceRow}>
                  <Text style={drawerStyles.sentenceJa}>
                    {s.vocab
                      ? highlightVocab(s.ja, s.vocab)
                      : <Text style={drawerStyles.sentenceJa}>{s.ja}</Text>
                    }
                  </Text>
                  <Text style={drawerStyles.sentenceEn}>{s.en}</Text>
                </View>
              ))}
            </DrawerSection>
          )}

          {/* Stroke Order */}
          <DrawerSection title="Stroke Order">
            <StrokeOrderAnimation character={item.character} width={300} height={240} />
          </DrawerSection>

          {/* References */}
          {(strokes != null || nelsonC != null || nelsonN != null || morohashi != null) && (
            <DrawerSection title="References">
              {strokes != null && (
                <View style={drawerStyles.refRow}>
                  <Text style={drawerStyles.refLabel}>Stroke count</Text>
                  <Text style={drawerStyles.refValue}>{strokes}</Text>
                </View>
              )}
              {nelsonC != null && (
                <TouchableOpacity style={drawerStyles.refRow} onPress={() => Linking.openURL(`https://jisho.org/search/${encodeURIComponent(item.character)}%23kanji`)} activeOpacity={0.7}>
                  <Text style={drawerStyles.refLabel}>Nelson Classic</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={[drawerStyles.refValue, { color: colors.primary }]}>#{nelsonC}</Text>
                    <Ionicons name="open-outline" size={12} color={colors.primary} />
                  </View>
                </TouchableOpacity>
              )}
              {nelsonN != null && (
                <TouchableOpacity style={drawerStyles.refRow} onPress={() => Linking.openURL(`https://jisho.org/search/${encodeURIComponent(item.character)}%23kanji`)} activeOpacity={0.7}>
                  <Text style={drawerStyles.refLabel}>New Nelson</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={[drawerStyles.refValue, { color: colors.primary }]}>#{nelsonN}</Text>
                    <Ionicons name="open-outline" size={12} color={colors.primary} />
                  </View>
                </TouchableOpacity>
              )}
              {morohashi != null && (
                <View style={drawerStyles.refRow}>
                  <Text style={drawerStyles.refLabel}>Morohashi</Text>
                  <Text style={drawerStyles.refValue}>{morohashi}</Text>
                </View>
              )}
            </DrawerSection>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={drawerStyles.section}>
      <Text style={drawerStyles.sectionTitle}>{title}</Text>
      <View style={drawerStyles.sectionBody}>{children}</View>
    </View>
  )
}

const drawerStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  jlptBadge: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  jlptText: { ...typography.caption, fontWeight: '700' },
  character: { ...typography.kanjiDisplay, color: colors.textPrimary, flex: 1, textAlign: 'center', fontSize: 40, lineHeight: 52 },
  closeBtn: { padding: spacing.xs },
  body: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl },
  section: { gap: spacing.sm },
  sectionTitle: { ...typography.h3, color: colors.textPrimary },
  sectionBody: { backgroundColor: colors.bgCard, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  meaningRow: { ...typography.body, color: colors.textPrimary },
  meaningIndex: { color: colors.textMuted },
  readingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  readingLabel: { ...typography.caption, color: colors.textMuted, width: 28 },
  readingValue: { ...typography.body, color: colors.textPrimary },
  vocabRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs },
  vocabWord: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  vocabReading: { ...typography.body, color: colors.textSecondary },
  vocabMeaning: { ...typography.bodySmall, color: colors.textMuted, flex: 1 },
  radicalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  radicalPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.bgElevated, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  radicalChar: { ...typography.h3, color: colors.textPrimary },
  radicalName: { ...typography.caption, color: colors.textMuted },
  refRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 2 },
  refLabel: { ...typography.bodySmall, color: colors.textMuted },
  refValue: { ...typography.bodySmall, color: colors.textPrimary, fontWeight: '600' },
  sentenceRow: {
    gap: 3,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  sentenceJa: { fontSize: 15, color: colors.textPrimary, lineHeight: 22 },
  sentenceEn: { ...typography.caption, color: colors.textMuted, lineHeight: 16 },
})

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
  // Magnifying glass icon — absolute bottom-left of kanjiArea, fades in on reveal
  detailsIcon: {
    position: 'absolute',
    bottom: spacing.md,
    left: spacing.md,
  },
  jlptText: { ...typography.caption, fontWeight: '700' },

  // Rōmaji toggle — top-left corner. zIndex:1 ensures it sits above the normal-flow
  // kanjiArea View (which renders later in JSX and would otherwise win touch events).
  romajiToggle: {
    position: 'absolute',
    zIndex: 1,
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

  // Example sentences
  sentences: { gap: spacing.sm, width: '100%' },
  sentenceRow: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: 3,
  },
  sentenceJa: { fontSize: 15, color: colors.textPrimary, lineHeight: 22 },
  sentenceEn: { ...typography.caption, color: colors.textMuted, lineHeight: 16 },

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
