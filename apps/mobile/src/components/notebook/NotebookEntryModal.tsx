import { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Modal, KeyboardAvoidingView, Platform,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import type { NotebookEntry } from '@kanji-learn/shared'
import { colors, radius, spacing, typography } from '../../theme'

// Every Text in this file carries an explicit colour — see NotebookBody.tsx
// for the B146 history this guards against. Colour is asserted explicitly
// in NotebookEntryModal.test.tsx; do not defeat it.

/** Pure presentational compose/edit modal for a notebook entry (an
 *  observation or a settled decision — see journal.tsx's
 *  NOTEBOOK_KIND_BY_SECTION). `entry` is the one being edited, or `null` when
 *  adding a new one. The screen owns all state (visibility, which entry, the
 *  save-in-flight flag) and passes it down; this component owns only the
 *  in-progress text of the field itself. */
export function NotebookEntryModal({
  visible,
  entry,
  saving = false,
  error = null,
  onSubmit,
  onDelete,
  onCancel,
}: {
  visible: boolean
  entry: NotebookEntry | null
  saving?: boolean
  /** Set when the last submit/delete failed (e.g. offline). The screen's
   *  FlatList-header error banner sits behind this modal's overlay, so a
   *  failed save while the modal is open must be shown here too — see
   *  journal.tsx's confirmDeleteEntry/handleEntrySubmit. */
  error?: string | null
  onSubmit: (text: string) => void
  onDelete: (entry: NotebookEntry) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(entry?.body ?? '')

  // Re-seed the draft whenever the modal opens (fresh add, or a different
  // entry to edit) rather than on every prop change, so the field isn't
  // stomped back to entry.body while the modal is open and the learner is
  // mid-edit.
  useEffect(() => {
    if (visible) setText(entry?.body ?? '')
  }, [visible, entry?.id])

  if (!visible) return null

  const isEditing = entry !== null

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{isEditing ? 'Edit note' : 'Add a note'}</Text>
              <TouchableOpacity onPress={onCancel} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.composeInput}
              placeholder="What did you notice, or what did you decide?"
              placeholderTextColor={colors.textMuted}
              value={text}
              onChangeText={setText}
              multiline
              autoFocus
            />
            {error && (
              <Text testID="notebook-entry-modal-error" style={styles.errorText}>
                {error}
              </Text>
            )}
            {isEditing && (
              <TouchableOpacity
                testID="notebook-entry-modal-delete"
                style={styles.deleteBtn}
                onPress={() => onDelete(entry)}
                accessibilityRole="button"
                accessibilityLabel="Remove this note"
              >
                <Text style={styles.deleteBtnText}>Remove</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.saveBtn, (!text.trim() || saving) && styles.disabled]}
              onPress={() => onSubmit(text.trim())}
              disabled={!text.trim() || saving}
            >
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save note'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.bgCard, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, gap: spacing.md },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { ...typography.h3, color: colors.textPrimary },
  composeInput: { ...typography.body, color: colors.textPrimary, backgroundColor: colors.bgSurface, borderRadius: radius.md, padding: spacing.md, minHeight: 120, textAlignVertical: 'top', borderWidth: 1, borderColor: colors.border },
  errorText: { ...typography.bodySmall, color: colors.error },
  deleteBtn: { alignSelf: 'flex-start' },
  deleteBtnText: { ...typography.bodySmall, color: colors.error },
  saveBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  saveBtnText: { ...typography.h3, color: '#fff' },
  disabled: { opacity: 0.4 },
})
