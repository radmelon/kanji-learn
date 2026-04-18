// apps/mobile/src/components/profile/DeleteAccountModal.tsx
//
// Two-state modal for confirming account deletion.
// - Idle: explanation + warning + input field. Destructive button disabled
//   until input === 'DELETE' (exact match, uppercase).
// - Submitting: spinner; both buttons disabled.
// On success: caller is responsible for routing (typically replace('/deleted')).
// On failure: Alert + modal stays open.

import { useState } from 'react'
import {
  View, Text, Modal, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useAuthStore } from '../../stores/auth.store'
import { colors, spacing, radius, typography } from '../../theme'

const CONFIRM_WORD = 'DELETE'

interface Props {
  visible: boolean
  onDismiss: () => void
}

export function DeleteAccountModal({ visible, onDismiss }: Props) {
  const router = useRouter()
  const { deleteAccount } = useAuthStore()
  const [input, setInput] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  const canConfirm = input === CONFIRM_WORD && !isDeleting

  const handleConfirm = async () => {
    setIsDeleting(true)
    try {
      await deleteAccount()
      // Route BEFORE state clears propagate so the user sees the farewell.
      router.replace('/deleted')
    } catch (err: any) {
      Alert.alert(
        'Deletion failed',
        err?.message ?? 'Please try again or contact support.',
      )
      setIsDeleting(false)
    }
    // On success we navigated away — no need to reset isDeleting.
  }

  const handleCancel = () => {
    if (isDeleting) return
    setInput('')
    onDismiss()
  }

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={handleCancel}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Delete account</Text>
          <Text style={styles.body}>
            This will permanently delete your account, kanji progress,
            mnemonics, and any active tutor shares. This cannot be undone.
          </Text>
          <Text style={styles.warning}>
            Any active tutor shares will be revoked.
          </Text>
          <Text style={styles.prompt}>
            Type <Text style={styles.confirmWord}>{CONFIRM_WORD}</Text> to confirm:
          </Text>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!isDeleting}
            placeholder={CONFIRM_WORD}
            placeholderTextColor={colors.textMuted}
          />
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.cancelButton, isDeleting && styles.disabled]}
              onPress={handleCancel}
              disabled={isDeleting}
              activeOpacity={0.8}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmButton, !canConfirm && styles.confirmDisabled]}
              onPress={handleConfirm}
              disabled={!canConfirm}
              activeOpacity={0.8}
            >
              {isDeleting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.confirmText}>Delete account</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: { ...typography.h2, color: colors.error },
  body: { ...typography.body, color: colors.textPrimary, lineHeight: 22 },
  warning: { ...typography.bodySmall, color: colors.warning, lineHeight: 20 },
  prompt: { ...typography.bodySmall, color: colors.textSecondary },
  confirmWord: { color: colors.error, fontWeight: '700' },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.textPrimary,
    ...typography.body,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  cancelText: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  confirmButton: {
    flex: 1,
    backgroundColor: colors.error,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  confirmDisabled: { opacity: 0.4 },
  confirmText: { ...typography.body, color: '#fff', fontWeight: '600' },
  disabled: { opacity: 0.5 },
})
