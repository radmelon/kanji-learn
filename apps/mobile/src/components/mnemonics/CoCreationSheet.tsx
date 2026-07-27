import { useEffect, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, Modal, Pressable, TouchableOpacity,
  ScrollView, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Speech from 'expo-speech'
import { lookupComponents } from '@kanji-learn/shared'
import { useCoCreation } from '../../mnemonics/useCoCreation'
import { getBestVoice } from '../../utils/tts'
import type { KanjiForHook } from '../../mnemonics/buildSlots'
import { colors, spacing, radius, typography } from '../../theme'

interface Props {
  visible: boolean
  kanji: KanjiForHook & { id: number }
  onClose: () => void
  onSaved?: (mnemonicId: string) => void
}

/** Human-friendly label for the assembly tier shown on the draft card — the raw
 *  AssemblyTier value (e.g. "on_device") is an internal identifier, not copy. */
const GENERATED_BY_LABELS: Record<string, string> = {
  cloud: 'Buddy cloud',
  on_device: 'On-device',
  template: 'Template',
}

/** "扌 (hand) beside 寺 (temple)" style teaching beat; degrades to "this part" for unmapped components. */
function teachingBeat(kanji: KanjiForHook): string {
  const mapped = lookupComponents(kanji.components)
  const parts = kanji.components.map((c) => {
    const entry = mapped.find((m) => m.char === c)
    return entry ? `${entry.char} (${entry.meaning})` : 'this part'
  })
  if (parts.length === 0) return ''
  if (parts.length === 1) return `${kanji.character} is ${parts[0]}.`
  return `${kanji.character} is ${parts.slice(0, -1).join(', ')} beside ${parts[parts.length - 1]}.`
}

export function CoCreationSheet({ visible, kanji, onClose, onSaved }: Props) {
  const { state, accept, setLocationText, submitAnchor, commit } = useCoCreation(kanji, kanji.id)
  // The sheet is pinned to the physical screen bottom (Modal ignores SafeAreaView),
  // so the home-indicator zone eats into the footer without this.
  const insets = useSafeAreaInsets()

  const [locationInput, setLocationInput] = useState('')
  const [anchorInput, setAnchorInput] = useState('')
  const [stickier, setStickier] = useState(false)
  const [personalDetailInput, setPersonalDetailInput] = useState('')
  const [readingPlayInput, setReadingPlayInput] = useState('')

  // The extras the CURRENT draft was built with. Typed text that differs from
  // this is "dirty" — the learner expects it in the story, but it isn't yet.
  // Three walkthrough failures in a row proved every natural gesture (return
  // key, tapping the big Save) silently discarded the detail, so: return key
  // rebuilds, and while dirty the footer's primary action becomes Rebuild.
  const [builtExtras, setBuiltExtras] = useState<{ p?: string; r?: string }>({})
  const trimmedDetail = personalDetailInput.trim() || undefined
  const trimmedPlay = readingPlayInput.trim() || undefined
  const stickierDirty =
    stickier &&
    (trimmedDetail !== undefined || trimmedPlay !== undefined) &&
    (trimmedDetail !== builtExtras.p || trimmedPlay !== builtExtras.r)

  const rebuildWithExtras = () => {
    if (!state.anchor || state.assembling) return
    setBuiltExtras({ p: trimmedDetail, r: trimmedPlay })
    submitAnchor(state.anchor, { personalDetail: trimmedDetail, readingPlay: trimmedPlay })
  }

  // Auto-advance out of location_inference once a name is inferred (e.g. from GPS).
  useEffect(() => {
    if (state.stage === 'location_inference' && state.locationName) {
      setLocationText(state.locationName)
    }
  }, [state.stage, state.locationName, setLocationText])

  // "Inferring location" feedback: accept() kicks off GPS + permission dialog +
  // reverse geocode, which can take seconds. Without this, the manual location
  // TextInput is visible (with autoFocus) the whole time, and a late GPS success
  // silently discards whatever the user already typed. Show a spinner instead
  // while inference is in flight; fall back to the TextInput on failure/timeout.
  const [inferring, setInferring] = useState(false)
  const inferringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (state.stage !== 'location_inference') {
      setInferring(false)
      if (inferringTimeoutRef.current) {
        clearTimeout(inferringTimeoutRef.current)
        inferringTimeoutRef.current = null
      }
    }
  }, [state.stage])

  useEffect(() => {
    if (state.stage === 'location_inference' && state.locationName && inferring) {
      setInferring(false)
    }
  }, [state.stage, state.locationName, inferring])

  useEffect(() => () => {
    if (inferringTimeoutRef.current) clearTimeout(inferringTimeoutRef.current)
  }, [])

  const handleAccept = async () => {
    setInferring(true)
    if (inferringTimeoutRef.current) clearTimeout(inferringTimeoutRef.current)
    inferringTimeoutRef.current = setTimeout(() => setInferring(false), 4000)
    try {
      await accept()
    } finally {
      // accept() has settled either way (place found or getPlace() returned
      // null) — the location_inference effect above already flips `inferring`
      // off if a name landed; this covers the "no location available" case
      // where the TextInput should reveal immediately rather than waiting
      // out the full timeout.
      setInferring(false)
      if (inferringTimeoutRef.current) {
        clearTimeout(inferringTimeoutRef.current)
        inferringTimeoutRef.current = null
      }
    }
  }

  // "Speak it" on the draft card — Buddy reads the hook aloud (complements the
  // "Read it aloud" microcopy). English voice: the story is English prose.
  const [speakingHook, setSpeakingHook] = useState(false)
  useEffect(() => {
    // Stop TTS if the draft changes (rebuild) or the sheet unmounts.
    Speech.stop()
    setSpeakingHook(false)
    return () => {
      Speech.stop()
    }
  }, [state.draft])

  const toggleSpeakHook = async () => {
    if (speakingHook) {
      Speech.stop()
      setSpeakingHook(false)
      return
    }
    if (!state.draft) return
    setSpeakingHook(true)
    const voice = await getBestVoice('en-US')
    Speech.speak(state.draft, {
      language: 'en-US',
      voice,
      onDone: () => setSpeakingHook(false),
      onStopped: () => setSpeakingHook(false),
      onError: () => setSpeakingHook(false),
    })
  }

  const meaning = kanji.meanings[0] ?? ''
  const beat = teachingBeat(kanji)

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Lift the whole sheet above the keyboard — the autoFocus inputs otherwise
          leave the prompt hidden behind the keyboard on open. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(spacing.xxl, insets.bottom + spacing.md) }]}
          onPress={() => {}}
        >
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={styles.kanjiPill}>
              <Text style={styles.kanji}>{kanji.character}</Text>
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>Build a hook</Text>
              <Text style={styles.meaning} numberOfLines={1}>{meaning}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {state.error && (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
                <Text style={styles.errorText}>Something didn't save. Give it another try.</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={() => commit()}>
                  <Text style={styles.retryBtnText}>Try again</Text>
                </TouchableOpacity>
              </View>
            )}

            {state.stage === 'consent' && (
              <View style={styles.stageBox}>
                <Text style={styles.prompt}>
                  {kanji.character} keeps slipping off the shelf — want to build a hook the monkey can't reach?
                </Text>
                <Text style={styles.subPrompt}>{meaning}</Text>
                {beat !== '' && (
                  <Text style={styles.teachingBeat}>{beat}</Text>
                )}
                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.primaryBtn} onPress={handleAccept}>
                    <Text style={styles.primaryBtnText}>Let's do it</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondaryBtn} onPress={onClose}>
                    <Text style={styles.secondaryBtnText}>Not now</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {state.stage === 'location_inference' && (
              <View style={styles.stageBox}>
                {state.locationName ? (
                  <Text style={styles.prompt}>Looks like you're near {state.locationName}.</Text>
                ) : inferring ? (
                  <View style={styles.inferringRow}>
                    <ActivityIndicator color={colors.primary} />
                    <Text style={styles.prompt}>Checking where you are…</Text>
                  </View>
                ) : (
                  <>
                    <Text style={styles.prompt}>Where are you right now?</Text>
                    <TextInput
                      style={styles.textInput}
                      value={locationInput}
                      onChangeText={setLocationInput}
                      placeholder="e.g. the kitchen, the train platform…"
                      placeholderTextColor={colors.textMuted}
                      autoFocus
                    />
                    <TouchableOpacity
                      style={[styles.primaryBtn, !locationInput.trim() && styles.disabled]}
                      onPress={() => setLocationText(locationInput.trim())}
                      disabled={!locationInput.trim()}
                    >
                      <Text style={styles.primaryBtnText}>Next</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}

            {state.stage === 'detail_elicitation' && (
              <View style={styles.stageBox}>
                <Text style={styles.prompt}>Look around — what's one thing that catches your eye?</Text>
                <TextInput
                  style={styles.textInput}
                  value={anchorInput}
                  onChangeText={setAnchorInput}
                  placeholder="e.g. a yellow vending machine"
                  placeholderTextColor={colors.textMuted}
                  autoFocus
                />
                <TouchableOpacity
                  style={[styles.primaryBtn, (!anchorInput.trim() || state.assembling) && styles.disabled]}
                  onPress={() => submitAnchor(anchorInput.trim())}
                  disabled={!anchorInput.trim() || state.assembling}
                >
                  <Text style={styles.primaryBtnText}>Build it</Text>
                </TouchableOpacity>
              </View>
            )}

            {state.stage === 'assembly' && (
              <View style={styles.stageBox}>
                {state.assembling ? (
                  <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
                ) : state.draft ? (
                  <>
                    <View style={styles.draftCard}>
                      <Text style={styles.storyText}>{state.draft}</Text>
                      <View style={styles.draftMetaRow}>
                        {state.generatedBy ? (
                          <View style={styles.generatedByTag}>
                            <Text style={styles.generatedByText}>
                              {GENERATED_BY_LABELS[state.generatedBy] ?? state.generatedBy}
                            </Text>
                          </View>
                        ) : (
                          <View />
                        )}
                        <TouchableOpacity style={styles.speakBtn} onPress={toggleSpeakHook} hitSlop={8}>
                          <Ionicons
                            name={speakingHook ? 'volume-high' : 'volume-medium-outline'}
                            size={18}
                            color={colors.primary}
                          />
                          <Text style={styles.speakBtnText}>{speakingHook ? 'Stop' : 'Speak it'}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    {stickier ? (
                      <View style={styles.stickierBox}>
                        <Text style={styles.subPrompt}>A personal detail that makes it yours?</Text>
                        <TextInput
                          style={styles.textInput}
                          value={personalDetailInput}
                          onChangeText={setPersonalDetailInput}
                          placeholder="e.g. wearing my blue jacket"
                          placeholderTextColor={colors.textMuted}
                          returnKeyType="done"
                          onSubmitEditing={rebuildWithExtras}
                        />
                        <Text style={styles.subPrompt}>A sound or wordplay for the reading?</Text>
                        <TextInput
                          style={styles.textInput}
                          value={readingPlayInput}
                          onChangeText={setReadingPlayInput}
                          placeholder='e.g. sounds like "mochi"'
                          placeholderTextColor={colors.textMuted}
                          returnKeyType="done"
                          onSubmitEditing={rebuildWithExtras}
                        />
                        {/* "Rebuild it" lives in the pinned footer, not here — buried
                            under the inputs it loses to the always-visible Save, and
                            typed details silently never make it into the hook. The
                            return key also rebuilds: "type answer, hit enter" is the
                            gesture learners actually reach for. */}
                      </View>
                    ) : (
                      <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStickier(true)}>
                        <Text style={styles.secondaryBtnText}>Make it stickier</Text>
                      </TouchableOpacity>
                    )}
                  </>
                ) : null}
              </View>
            )}

            {state.stage === 'commitment' && (
              <View style={styles.stageBox}>
                <Text style={styles.prompt}>Saved. We'll quick-check it in a moment.</Text>
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => {
                    if (state.mnemonicId) onSaved?.(state.mnemonicId)
                    onClose()
                  }}
                >
                  <Text style={styles.primaryBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>

          {/* Save is pinned below the scroll area — on smaller screens the draft
              card + stickier inputs push it below the fold inside the ScrollView,
              and an off-screen primary CTA reads as "no way to save". */}
          {state.stage === 'assembly' && !state.assembling && state.draft ? (
            <View style={styles.footer}>
              <Text style={styles.microcopy}>Read it aloud — even a whisper.</Text>
              <View style={styles.actionRow}>
                {stickier && (
                  <TouchableOpacity
                    style={[
                      stickierDirty ? styles.primaryBtn : styles.secondaryBtn,
                      !trimmedDetail && !trimmedPlay && styles.disabled,
                    ]}
                    onPress={rebuildWithExtras}
                    disabled={!trimmedDetail && !trimmedPlay}
                  >
                    <Text style={stickierDirty ? styles.primaryBtnText : styles.secondaryBtnText}>
                      Rebuild it
                    </Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={stickierDirty ? styles.secondaryBtn : styles.primaryBtn}
                  onPress={commit}
                  disabled={state.saving}
                >
                  {state.saving ? (
                    <ActivityIndicator size="small" color={stickierDirty ? colors.primary : '#fff'} />
                  ) : (
                    <Text style={stickierDirty ? styles.secondaryBtnText : styles.primaryBtnText}>
                      {stickierDirty ? 'Save without it' : 'Save this'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bgCard,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    maxHeight: '80%',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: radius.full,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  kanjiPill: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: colors.primary + '22',
    borderWidth: 1,
    borderColor: colors.primary + '44',
    alignItems: 'center',
    justifyContent: 'center',
  },
  kanji: { fontSize: 28, color: colors.primary },
  headerText: { flex: 1 },
  title: { ...typography.h3, color: colors.textPrimary },
  meaning: { ...typography.bodySmall, color: colors.textSecondary },
  // flexShrink is required: RN defaults it to 0, so a long draft would push the
  // pinned footer past the sheet's maxHeight instead of scrolling.
  scroll: { flexGrow: 0, flexShrink: 1 },
  scrollContent: { gap: spacing.md, paddingBottom: spacing.md },
  stageBox: { gap: spacing.md },
  inferringRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  prompt: { ...typography.body, color: colors.textPrimary, lineHeight: 22 },
  subPrompt: { ...typography.bodySmall, color: colors.textSecondary },
  teachingBeat: { ...typography.bodySmall, color: colors.textSecondary, fontStyle: 'italic' },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  textInput: {
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary + '55',
    padding: spacing.md,
  },
  primaryBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
  },
  primaryBtnText: { ...typography.h3, color: '#fff' },
  secondaryBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
  },
  secondaryBtnText: { ...typography.bodySmall, color: colors.textSecondary, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  draftCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  storyText: { ...typography.body, color: colors.textPrimary, lineHeight: 22 },
  generatedByTag: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accent + '22',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  generatedByText: { ...typography.caption, color: colors.accent, fontWeight: '700' },
  draftMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  speakBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 2, paddingHorizontal: spacing.sm },
  speakBtnText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  stickierBox: { gap: spacing.sm },
  footer: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  microcopy: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.error + '11',
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  errorText: { ...typography.caption, color: colors.error, flex: 1 },
  retryBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    backgroundColor: colors.error + '22',
    borderRadius: radius.full,
  },
  retryBtnText: { ...typography.caption, color: colors.error, fontWeight: '600' },
})
