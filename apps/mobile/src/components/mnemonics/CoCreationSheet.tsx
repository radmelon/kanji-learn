import { useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, Modal, Pressable, TouchableOpacity,
  ScrollView, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Speech from 'expo-speech'
import { teachingBeat } from '../../lib/teaching-beat'
import { useCoCreation, defaultCoCreationDeps } from '../../mnemonics/useCoCreation'
import { useProfile } from '../../hooks/useProfile'
import { getBestVoice } from '../../utils/tts'
import type { KanjiForHook } from '../../mnemonics/buildSlots'
import { snoozeBuddyMoment } from '../../mnemonics/cocreationApi'
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

export function CoCreationSheet({ visible, kanji, onClose, onSaved }: Props) {
  const { profile, update: updateProfile } = useProfile()
  // The privacy switch governs absolutely (design spec §9). Passed as a dep so
  // the hook can skip GPS without the sheet knowing how location works.
  const coCreationDeps = useMemo(
    () => ({ ...defaultCoCreationDeps, attachLocationToHooks: profile?.attachLocationToHooks ?? false }),
    [profile?.attachLocationToHooks],
  )
  const { state, accept, setLocationText, confirmLocation, submitAnchor, commit } =
    useCoCreation(kanji, kanji.id, coCreationDeps)
  // The sheet is pinned to the physical screen bottom (Modal ignores SafeAreaView),
  // so the home-indicator zone eats into the footer without this.
  const insets = useSafeAreaInsets()

  const [locationInput, setLocationInput] = useState('')
  /** "Somewhere else" — the inferred place was wrong, so show the text input
   *  even though state.locationName is populated. */
  const [rejectedInferred, setRejectedInferred] = useState(false)
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

  // The auto-advance that used to live here is gone. It fired the moment a
  // place name arrived, so "Looks like you're near X" — the whole point of the
  // grant path — was never on screen long enough to be seen. The learner now
  // confirms it, which is also how they say "somewhere else".

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

  // "Not now" is a decision about THIS kanji, and it has to survive the sheet
  // closing (parent spec §11). Plan 3b just closed and forgot, so the same
  // offer could return the next session — the fastest way to make a helpful
  // feature feel like nagging. Fire-and-forget: failing to record a decline
  // must not trap the learner in a sheet they are trying to dismiss.
  const handleNotNow = () => {
    snoozeBuddyMoment(kanji.id).catch(() => {})
    onClose()
  }

  // Only ask when we actually know the answer is missing. `profile` is null
  // while loading, and asking on a maybe would re-ask people who already said
  // no — the one thing a "we'll only ask once" promise cannot do.
  const [askAnswered, setAskAnswered] = useState(false)
  const needsLocationAsk =
    !askAnswered && profile != null && profile.hookLocationAskSeenAt == null

  const answerLocationAsk = async (allow: boolean) => {
    // Optimistic: the flow continues immediately either way. A failed PATCH
    // means the ask returns next time, which is the safe direction to fail —
    // far better than silently treating an unrecorded answer as consent.
    setAskAnswered(true)
    updateProfile({
      attachLocationToHooks: allow,
      hookLocationAskSeenAt: new Date().toISOString(),
    } as never)
    // Pass the answer explicitly — the PATCH above has not landed yet, so the
    // profile still says whatever it said before they answered.
    await handleAccept(allow)
  }

  const handleAccept = async (allowLocation?: boolean) => {
    // Accepting clears any earlier decline — the learner changed their mind,
    // and a stale cooldown would suppress the reinforce offers this hook is
    // about to start earning.
    snoozeBuddyMoment(kanji.id, false).catch(() => {})
    setInferring(true)
    if (inferringTimeoutRef.current) clearTimeout(inferringTimeoutRef.current)
    inferringTimeoutRef.current = setTimeout(() => setInferring(false), 4000)
    try {
      await accept(allowLocation)
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
            showsVerticalScrollIndicator
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
                {/* The one-time location ask (design spec §9). Asked HERE, in
                    flow, rather than buried in Profile — this is the only
                    moment where "should this hook remember where you are?" is
                    a question with visible stakes. Answered once, either way,
                    and never asked again; the stamp is server-side so a
                    reinstall does not re-ask. */}
                {needsLocationAsk ? (
                  <View style={styles.stageBox}>
                    <Text style={styles.subPrompt}>
                      One thing first — hooks stick better when they’re tied to a
                      real place. Want Buddy to remember where you build them?
                    </Text>
                    <Text style={styles.teachingBeat}>
                      Just the place name and rough coordinates, stored with the hook.
                      You can change this any time in Profile → Privacy.
                    </Text>
                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        style={styles.primaryBtn}
                        onPress={() => answerLocationAsk(true)}
                      >
                        <Text style={styles.primaryBtnText}>Yes, remember it</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.secondaryBtn}
                        onPress={() => answerLocationAsk(false)}
                      >
                        <Text style={styles.secondaryBtnText}>No thanks</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View style={styles.actionRow}>
                    {/* Wrapped, not passed directly: onPress hands the gesture
                        event to the first argument, and a truthy event would
                        read as "location allowed" on every tap. */}
                    <TouchableOpacity style={styles.primaryBtn} onPress={() => handleAccept()}>
                      <Text style={styles.primaryBtnText}>Let's do it</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.secondaryBtn} onPress={handleNotNow}>
                      <Text style={styles.secondaryBtnText}>Not now</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            {state.stage === 'location_inference' && (
              <View style={styles.stageBox}>
                {state.locationName && !rejectedInferred ? (
                  <>
                    <Text style={styles.prompt}>Looks like you're near {state.locationName}.</Text>
                    <View style={styles.actionRow}>
                      <TouchableOpacity style={styles.primaryBtn} onPress={confirmLocation}>
                        <Text style={styles.primaryBtnText}>That's right</Text>
                      </TouchableOpacity>
                      {/* Falls through to the typed input below; LOCATION_TEXT
                          then discards the coordinates they just rejected. */}
                      <TouchableOpacity style={styles.secondaryBtn} onPress={() => setRejectedInferred(true)}>
                        <Text style={styles.secondaryBtnText}>Somewhere else</Text>
                      </TouchableOpacity>
                    </View>
                  </>
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
                {/* No immediate quick-check here (dropped 2026-07-28, B-218).
                    It asked "which kanji is this hook for?" inside a sheet
                    whose header displays that kanji — a question with no
                    failure mode — and its choice tiles were clipped below a
                    long story, leaving the learner with no action and no exit.
                    The due stamp is still written by buildContext, so the
                    next-session recall quiz — which does measure retention —
                    is unaffected. */}
                <Text style={styles.prompt}>Saved. We'll test it next session.</Text>
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
  // B-215/B-220: and flexShrink alone is not enough — Yoga gives flex items
  // `minHeight: auto`, so this would not shrink below its content's intrinsic
  // height and the overflow went to the footer anyway. The 510-character 暗
  // hook was the first story tall enough to expose it.
  scroll: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
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
    // Never the thing that shrinks — it carries the only way forward (B-215).
    flexShrink: 0,
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
