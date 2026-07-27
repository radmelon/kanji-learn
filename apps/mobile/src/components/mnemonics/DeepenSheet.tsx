import { useState } from 'react'
import {
  View, Text, StyleSheet, Modal, Pressable, TouchableOpacity,
  ScrollView, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { AssemblerSlots, CoCreationContext } from '@kanji-learn/shared'
import { useDeepen, THREAD_PROMPTS, type ThreadSource } from '../../mnemonics/useDeepen'
import { colors, spacing, radius, typography } from '../../theme'

interface Props {
  visible: boolean
  mnemonicId: string
  kanjiCharacter: string
  context: CoCreationContext
  slots: AssemblerSlots
  onClose: () => void
  /** The hook grew — the host should reload it. */
  onDeepened?: () => void
}

const THREAD_LABELS: Record<ThreadSource, { title: string; blurb: string; icon: 'eye-outline' | 'git-branch-outline' }> = {
  environment: {
    title: 'Add a detail',
    blurb: 'Something you can see, hear or feel right now',
    icon: 'eye-outline',
  },
  known_knowledge: {
    title: 'Connect it to something',
    blurb: 'Another kanji, a word, a memory you already have cold',
    icon: 'git-branch-outline',
  },
}

/**
 * "Go deeper" — one entry, two kinds of thread (parent spec §6.3).
 *
 * The whole sheet is written to be additive. Nothing here says rebuild, start
 * over, replace or discard, because nothing is: `buildDeepenedContext` appends
 * a layer and every earlier one survives. The copy has to match the data model
 * or the learner will believe they are about to lose what they wrote.
 */
export function DeepenSheet({
  visible, mnemonicId, kanjiCharacter, context, slots, onClose, onDeepened,
}: Props) {
  const { thread, chooseThread, submitAnswer, isSubmitting, error } = useDeepen(
    mnemonicId, context, slots,
  )
  const insets = useSafeAreaInsets()
  const [answer, setAnswer] = useState('')

  const handleSubmit = async () => {
    const ok = await submitAnswer(answer)
    if (ok) {
      setAnswer('')
      onDeepened?.()
      onClose()
    }
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
                <Text style={styles.title}>Go deeper</Text>
                <Text style={styles.subtitle}>
                  {context.layerCount === 1
                    ? 'One layer so far'
                    : `${context.layerCount} layers so far`}
                </Text>
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
              {error && (
                <View style={styles.errorBanner}>
                  <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
                  <Text style={styles.errorText}>That didn’t save. Your answer is still here.</Text>
                </View>
              )}

              {thread === null ? (
                <>
                  <Text style={styles.prompt}>
                    Your hook is still there — we’re adding to it, not starting over.
                  </Text>
                  {(Object.keys(THREAD_LABELS) as ThreadSource[]).map((t) => (
                    <TouchableOpacity
                      key={t}
                      style={styles.threadBtn}
                      onPress={() => chooseThread(t)}
                      activeOpacity={0.85}
                    >
                      <Ionicons name={THREAD_LABELS[t].icon} size={20} color={colors.primary} />
                      <View style={styles.threadBody}>
                        <Text style={styles.threadTitle}>{THREAD_LABELS[t].title}</Text>
                        <Text style={styles.threadBlurb}>{THREAD_LABELS[t].blurb}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                  ))}
                </>
              ) : (
                <>
                  <Text style={styles.prompt}>{THREAD_PROMPTS[thread]}</Text>
                  <TextInput
                    style={styles.textInput}
                    value={answer}
                    onChangeText={setAnswer}
                    placeholder={
                      thread === 'known_knowledge'
                        ? 'e.g. the 寺 in 時 — same temple'
                        : 'e.g. the rain on the window'
                    }
                    placeholderTextColor={colors.textMuted}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={handleSubmit}
                  />
                </>
              )}
            </ScrollView>

            {thread !== null && (
              <View style={styles.footer}>
                <TouchableOpacity
                  style={[styles.primaryBtn, (!answer.trim() || isSubmitting) && styles.disabled]}
                  onPress={handleSubmit}
                  disabled={!answer.trim() || isSubmitting}
                >
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.primaryBtnText}>Add this thread</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bgCard,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    maxHeight: '80%',
  },
  handle: {
    width: 36, height: 4, backgroundColor: colors.border,
    borderRadius: radius.full, alignSelf: 'center', marginBottom: spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  kanjiPill: {
    width: 52, height: 52, borderRadius: radius.lg,
    backgroundColor: colors.primary + '22',
    borderWidth: 1, borderColor: colors.primary + '44',
    alignItems: 'center', justifyContent: 'center',
  },
  kanji: { fontSize: 28, color: colors.primary },
  headerText: { flex: 1 },
  title: { ...typography.h3, color: colors.textPrimary },
  subtitle: { ...typography.bodySmall, color: colors.textSecondary },
  // flexShrink is required: RN defaults it to 0, so long content would push
  // the pinned footer past the sheet's maxHeight instead of scrolling.
  scroll: { flexGrow: 0, flexShrink: 1 },
  scrollContent: { gap: spacing.md, paddingBottom: spacing.md },
  prompt: { ...typography.body, color: colors.textPrimary, lineHeight: 22 },
  threadBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },
  threadBody: { flex: 1, gap: 2 },
  threadTitle: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  threadBlurb: { ...typography.caption, color: colors.textMuted },
  textInput: {
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary + '55',
    padding: spacing.md,
  },
  footer: {
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  primaryBtn: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primary, borderRadius: radius.lg, paddingVertical: spacing.md,
  },
  primaryBtnText: { ...typography.h3, color: '#fff' },
  disabled: { opacity: 0.5 },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: colors.error + '11', borderRadius: radius.sm, padding: spacing.sm,
  },
  errorText: { ...typography.caption, color: colors.error, flex: 1 },
})
