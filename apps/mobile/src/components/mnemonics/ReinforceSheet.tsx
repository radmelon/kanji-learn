import {
  View, Text, StyleSheet, Modal, Pressable, TouchableOpacity,
  ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Speech from 'expo-speech'
import { useReinforce } from '../../mnemonics/useReinforce'
import { getBestVoice } from '../../utils/tts'
import { colors, spacing, radius, typography } from '../../theme'

interface Props {
  visible: boolean
  /** The hook being tested. */
  mnemonicId: string
  kanjiCharacter: string
  meaning: string
  storyText: string
  onClose: () => void
  /** Fired when the deepen gate trips — the caller opens the deepen flow. */
  onOfferDeepen?: (mnemonicId: string) => void
}

/**
 * The end-of-session reinforce moment (parent spec §4.3).
 *
 * Two taps and one judgement: recall the scene, recall the reading, then say
 * whether picturing it helped. Deliberately the lightest possible interaction —
 * this fires when the learner has just finished studying and has no energy for
 * anything longer.
 *
 * Mirrors CoCreationSheet's Modal scaffolding, including the three layout
 * fixes that cost a day of B142 debugging: KeyboardAvoidingView, a footer
 * pinned inside the safe-area inset, and `flexShrink: 1` on the ScrollView
 * (RN defaults it to 0, so long content shoves the footer off-screen).
 */
export function ReinforceSheet({
  visible,
  mnemonicId,
  kanjiCharacter,
  meaning,
  storyText,
  onClose,
  onOfferDeepen,
}: Props) {
  const { state, reveal, submitOutcome } = useReinforce(mnemonicId)
  // The sheet is pinned to the physical screen bottom (Modal ignores
  // SafeAreaView), so the home-indicator zone eats the footer without this.
  const insets = useSafeAreaInsets()

  const speakStory = async () => {
    Speech.speak(storyText, { voice: await getBestVoice('en-US'), rate: 0.95 })
  }

  const finish = () => {
    if (state.shouldOfferDeepen) onOfferDeepen?.(mnemonicId)
    else onClose()
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
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
                <Text style={styles.kanji}>{kanjiCharacter}</Text>
              </View>
              <View style={styles.headerText}>
                <Text style={styles.title}>Let&apos;s test your hook</Text>
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
              {/* Step 1 — recall the scene. The story stays hidden until the
                  learner has tried; showing it first would remove the retrieval. */}
              <View style={styles.stageBox}>
                <Text style={styles.prompt}>
                  {kanjiCharacter} slipped again today. You built a hook for it — picture the scene.
                  What was in it?
                </Text>

                {state.step === 'scene' ? (
                  <TouchableOpacity style={styles.secondaryBtn} onPress={reveal}>
                    <Text style={styles.secondaryBtnText}>Show me the hook</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.storyCard}>
                    <Text style={styles.storyText}>{storyText}</Text>
                    <TouchableOpacity style={styles.speakBtn} onPress={speakStory} hitSlop={8}>
                      <Ionicons name="volume-medium-outline" size={18} color={colors.primary} />
                      <Text style={styles.speakBtnText}>Speak it</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {/* Step 2 — recall the reading. */}
              {(state.step === 'reading' || state.step === 'self_report' || state.step === 'done') && (
                <View style={styles.stageBox}>
                  <Text style={styles.prompt}>Good. So — how do you read {kanjiCharacter}?</Text>
                  {state.step === 'reading' && (
                    <TouchableOpacity style={styles.secondaryBtn} onPress={reveal}>
                      <Text style={styles.secondaryBtnText}>Reveal the reading</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Step 3 — one self-report, which drives the EMA. */}
              {state.step === 'self_report' && (
                <View style={styles.stageBox}>
                  <Text style={styles.prompt}>Did picturing the scene help you land it?</Text>
                  {state.isSubmitting ? (
                    <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
                  ) : (
                    <View style={styles.choiceRow}>
                      <TouchableOpacity
                        style={styles.primaryBtn}
                        onPress={() => submitOutcome(1)}
                      >
                        <Text style={styles.primaryBtnText}>👍 It helped</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.secondaryBtn}
                        onPress={() => submitOutcome(0)}
                      >
                        <Text style={styles.secondaryBtnText}>Not really</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}

              {/* Done. Copy is additive on purpose — never "rebuild" or
                  "start over" (parent spec §6.3). */}
              {state.step === 'done' && (
                <View style={styles.stageBox}>
                  <Text style={styles.prompt}>
                    {state.shouldOfferDeepen
                      ? `This hook is fading a little. Let's not toss it — let's give it more to hold onto.`
                      : `Nice. We'll keep testing it as ${kanjiCharacter} comes around.`}
                  </Text>
                </View>
              )}
            </ScrollView>

            {/* Pinned footer. Inside the ScrollView it would be pushed below the
                fold once the story card renders. */}
            {state.step === 'done' && (
              <View style={styles.footer}>
                <TouchableOpacity style={styles.primaryBtn} onPress={finish}>
                  <Text style={styles.primaryBtnText}>
                    {state.shouldOfferDeepen ? 'Go deeper' : 'Done'}
                  </Text>
                </TouchableOpacity>
                {state.shouldOfferDeepen && (
                  <TouchableOpacity style={styles.textBtn} onPress={onClose}>
                    <Text style={styles.textBtnText}>Not now</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
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
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kanji: { fontSize: 28, color: colors.textPrimary },
  headerText: { flex: 1 },
  title: { ...typography.h3, color: colors.textPrimary },
  meaning: { ...typography.caption, color: colors.textMuted },
  // flexShrink is required: RN defaults it to 0, so a long story would push
  // the pinned footer past the sheet's maxHeight instead of scrolling.
  scroll: { flexGrow: 0, flexShrink: 1 },
  scrollContent: { gap: spacing.md, paddingBottom: spacing.md },
  stageBox: { gap: spacing.sm },
  prompt: { ...typography.body, color: colors.textPrimary },
  storyCard: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  storyText: { ...typography.body, color: colors.textPrimary, lineHeight: 22 },
  speakBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  speakBtnText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  choiceRow: { flexDirection: 'row', gap: spacing.sm },
  primaryBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  primaryBtnText: { ...typography.body, color: '#fff', fontWeight: '600' },
  secondaryBtn: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  secondaryBtnText: { ...typography.body, color: colors.primary, fontWeight: '600' },
  textBtn: { alignItems: 'center', paddingVertical: spacing.xs },
  textBtnText: { ...typography.caption, color: colors.textMuted },
  footer: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
})
