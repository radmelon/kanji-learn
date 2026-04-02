import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, Modal, Pressable, TouchableOpacity,
  ScrollView, TextInput, ActivityIndicator, Alert,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useMnemonics } from '../../hooks/useMnemonics'
import { colors, spacing, radius, typography } from '../../theme'

interface Props {
  visible: boolean
  kanjiId: number
  character: string
  meaning: string
  onDismiss: () => void
}

export function MnemonicNudgeSheet({ visible, kanjiId, character, meaning, onDismiss }: Props) {
  const { mnemonics, isLoading, isGenerating, load, generate, save } = useMnemonics(kanjiId)
  const [composing, setComposing] = useState(false)
  const [draft, setDraft] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (visible) {
      load()
      setComposing(false)
      setDraft('')
    }
  }, [visible, kanjiId])

  const handleGenerate = useCallback(async () => {
    try {
      await generate('haiku')
    } catch {
      Alert.alert('Error', 'Could not generate mnemonic. Check your connection.')
    }
  }, [generate])

  const handleSave = useCallback(async () => {
    if (!draft.trim()) return
    setIsSaving(true)
    try {
      await save(draft.trim())
      setComposing(false)
      setDraft('')
    } catch {
      Alert.alert('Error', 'Could not save mnemonic.')
    } finally {
      setIsSaving(false)
    }
  }, [draft, save])

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          {/* Handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.kanjiPill}>
              <Text style={styles.kanji}>{character}</Text>
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>Memory aid</Text>
              <Text style={styles.meaning} numberOfLines={1}>{meaning}</Text>
            </View>
            <TouchableOpacity onPress={onDismiss} hitSlop={8}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Mnemonics */}
            {isLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
            ) : mnemonics.length === 0 ? (
              <Text style={styles.emptyText}>No mnemonic yet for this kanji.</Text>
            ) : (
              mnemonics.map((m) => (
                <View key={m.id} style={[styles.mnemonicCard, m.type === 'user' && styles.userCard]}>
                  <View style={styles.mnemonicBadgeRow}>
                    <View style={[styles.badge, m.type === 'system' ? styles.aiBadge : styles.mineBadge]}>
                      <Ionicons
                        name={m.type === 'system' ? 'sparkles' : 'person'}
                        size={10}
                        color={m.type === 'system' ? colors.accent : colors.primary}
                      />
                      <Text style={[styles.badgeText, { color: m.type === 'system' ? colors.accent : colors.primary }]}>
                        {m.type === 'system' ? 'AI' : 'Mine'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.storyText}>{m.storyText}</Text>
                </View>
              ))
            )}

            {/* Compose area */}
            {composing ? (
              <View style={styles.composeBox}>
                <TextInput
                  style={styles.composeInput}
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Write your own memory story…"
                  placeholderTextColor={colors.textMuted}
                  multiline
                  autoFocus
                />
                <View style={styles.composeActions}>
                  <TouchableOpacity
                    onPress={() => { setComposing(false); setDraft('') }}
                    style={styles.cancelBtn}
                  >
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleSave}
                    style={[styles.saveBtn, (!draft.trim() || isSaving) && styles.disabled]}
                    disabled={!draft.trim() || isSaving}
                  >
                    <Text style={styles.saveBtnText}>{isSaving ? 'Saving…' : 'Save'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={handleGenerate}
                  disabled={isGenerating}
                >
                  {isGenerating
                    ? <ActivityIndicator size="small" color={colors.accent} />
                    : <Ionicons name="sparkles" size={16} color={colors.accent} />
                  }
                  <Text style={[styles.actionBtnText, { color: colors.accent }]}>
                    {isGenerating ? 'Generating…' : 'Generate AI'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => setComposing(true)}
                >
                  <Ionicons name="pencil-outline" size={16} color={colors.primary} />
                  <Text style={[styles.actionBtnText, { color: colors.primary }]}>Write mine</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>

          {/* Continue button */}
          <TouchableOpacity style={styles.continueBtn} onPress={onDismiss}>
            <Text style={styles.continueBtnText}>Continue studying</Text>
            <Ionicons name="arrow-forward" size={16} color="#fff" />
          </TouchableOpacity>
        </Pressable>
      </Pressable>
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
  scroll: { flexGrow: 0 },
  scrollContent: { gap: spacing.md, paddingBottom: spacing.md },
  emptyText: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.lg },
  mnemonicCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  userCard: { borderColor: colors.primary + '44' },
  mnemonicBadgeRow: { flexDirection: 'row' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  aiBadge: { backgroundColor: colors.accent + '22' },
  mineBadge: { backgroundColor: colors.primary + '22' },
  badgeText: { ...typography.caption, fontWeight: '700' },
  storyText: { ...typography.body, color: colors.textPrimary, lineHeight: 22 },
  composeBox: { gap: spacing.sm },
  composeInput: {
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary + '55',
    padding: spacing.md,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  composeActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  cancelBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  cancelText: { ...typography.bodySmall, color: colors.textMuted },
  saveBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
  },
  saveBtnText: { ...typography.bodySmall, color: '#fff', fontWeight: '600' },
  disabled: { opacity: 0.5 },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
  },
  actionBtnText: { ...typography.bodySmall, fontWeight: '600' },
  continueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  continueBtnText: { ...typography.h3, color: '#fff' },
})
