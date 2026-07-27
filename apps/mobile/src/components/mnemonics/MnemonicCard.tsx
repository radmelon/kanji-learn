import { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, TextInput, StyleSheet, Alert, Image } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as Location from 'expo-location'
import { Ionicons } from '@expo/vector-icons'
import { colors, spacing, radius, typography } from '../../theme'
import type { Mnemonic } from '../../hooks/useMnemonics'

interface Props {
  mnemonic: Mnemonic
  onUpdate?: (id: string, text: string) => Promise<void>
  onUpdatePhoto?: (id: string, imageUrl: string | null) => Promise<void>
  onDelete?: (id: string) => Promise<void>
}

export function MnemonicCard({
  mnemonic,
  onUpdate,
  onUpdatePhoto,
  onDelete,
}: Props) {
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(mnemonic.storyText)
  const [isSaving, setIsSaving] = useState(false)
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false)
  const [locationLabel, setLocationLabel] = useState<string | null>(null)

  useEffect(() => {
    if (!mnemonic.latitude || !mnemonic.longitude) return
    Location.reverseGeocodeAsync({ latitude: mnemonic.latitude, longitude: mnemonic.longitude })
      .then(([place]) => {
        if (!place) return
        const label = place.city || place.district || place.region || place.country
        if (label) setLocationLabel(label)
      })
      .catch(() => {})
  }, [mnemonic.latitude, mnemonic.longitude])

  const handlePickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo library access to attach images.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.5,
      base64: true,
    })
    if (result.canceled || !result.assets[0].base64) return
    setIsUploadingPhoto(true)
    try {
      const dataUrl = `data:image/jpeg;base64,${result.assets[0].base64}`
      await onUpdatePhoto?.(mnemonic.id, dataUrl)
    } catch {
      Alert.alert('Error', 'Failed to save photo.')
    } finally {
      setIsUploadingPhoto(false)
    }
  }

  const handleRemovePhoto = () => {
    Alert.alert('Remove photo?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => onUpdatePhoto?.(mnemonic.id, null) },
    ])
  }

  const isSystem = mnemonic.type === 'system'
  const isHook = mnemonic.generationMethod === 'cocreated'
  const context = mnemonic.cocreationContext ?? null
  // Layer 0 is the original scene; anything after it was added by "Go deeper".
  // The stack is the point — §6.3 is emphatic that a hook only accumulates, so
  // showing just the latest story would hide the history it was built from.
  const addedLayers = context?.layers?.slice(1) ?? []
  // "built at Beppu Station" — where the hook was born. Falls back to the
  // reverse-geocoded coordinate label for pre-Phase-5 rows that have coords
  // but no context.
  const builtAt = context?.locationName ?? locationLabel

  const handleSave = async () => {
    if (!editText.trim() || editText === mnemonic.storyText) {
      setIsEditing(false)
      return
    }
    setIsSaving(true)
    try {
      await onUpdate?.(mnemonic.id, editText.trim())
      setIsEditing(false)
    } catch {
      Alert.alert('Error', 'Failed to save changes')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = () => {
    Alert.alert('Delete mnemonic?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await onDelete?.(mnemonic.id)
          } catch {
            Alert.alert('Error', 'Failed to delete mnemonic.')
          }
        },
      },
    ])
  }

  return (
    <View style={[styles.card, isHook && styles.hookCard]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={[styles.typeBadge, isHook ? styles.hookBadge : isSystem ? styles.systemBadge : styles.userBadge]}>
          <Ionicons
            name={isHook ? 'link' : isSystem ? 'sparkles' : 'person'}
            size={10}
            color={isHook ? colors.primary : isSystem ? colors.accent : colors.primary}
          />
          <Text style={[styles.typeLabel, isHook ? styles.userLabel : isSystem ? styles.systemLabel : styles.userLabel]}>
            {isHook ? 'Hook' : isSystem ? 'AI' : 'Mine'}
          </Text>
        </View>

        {/* Depth, not a count of taps — "3 layers" is the hook's history. */}
        {context && context.layerCount > 1 && (
          <View style={styles.depthBadge}>
            <Text style={styles.depthText}>{context.layerCount} layers</Text>
          </View>
        )}

        {builtAt && (
          <View style={styles.locationBadge}>
            <Ionicons name="location-outline" size={10} color={colors.textMuted} />
            <Text style={styles.locationText} numberOfLines={1}>
              {isHook ? `built at ${builtAt}` : builtAt}
            </Text>
          </View>
        )}

        {!isSystem && !isEditing && (
          <View style={styles.actions}>
            <TouchableOpacity onPress={() => setIsEditing(true)} style={styles.iconBtn}>
              <Ionicons name="pencil-outline" size={16} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDelete} style={styles.iconBtn}>
              <Ionicons name="trash-outline" size={16} color={colors.error} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Photo */}
      {mnemonic.imageUrl ? (
        <View style={styles.photoContainer}>
          <Image source={{ uri: mnemonic.imageUrl }} style={styles.photo} resizeMode="cover" />
          {!isSystem && (
            <TouchableOpacity style={styles.removePhotoBtn} onPress={handleRemovePhoto}>
              <Ionicons name="close-circle" size={22} color={colors.error} />
            </TouchableOpacity>
          )}
        </View>
      ) : !isSystem && onUpdatePhoto ? (
        <TouchableOpacity
          style={styles.addPhotoBtn}
          onPress={handlePickPhoto}
          disabled={isUploadingPhoto}
        >
          <Ionicons name="image-outline" size={16} color={colors.textMuted} />
          <Text style={styles.addPhotoText}>
            {isUploadingPhoto ? 'Saving…' : 'Add photo'}
          </Text>
        </TouchableOpacity>
      ) : null}

      {/* Story text */}
      {isEditing ? (
        <TextInput
          style={styles.editInput}
          value={editText}
          onChangeText={setEditText}
          multiline
          autoFocus
          placeholderTextColor={colors.textMuted}
        />
      ) : (
        <Text style={styles.story}>{mnemonic.storyText}</Text>
      )}

      {/* The threads added since. The assembled story above already weaves them
          in, so these are shown as what the learner actually said — the raw
          material, in the order they added it. */}
      {!isEditing && addedLayers.length > 0 && (
        <View style={styles.layerStack}>
          {addedLayers.map((layer, i) => (
            <View key={i} style={styles.layer}>
              <View style={styles.layerRail} />
              <View style={styles.layerBody}>
                <Text style={styles.layerSource}>
                  {layer.source === 'known_knowledge' ? 'Connected to' : 'Added detail'}
                </Text>
                <Text style={styles.layerAnswer}>{layer.answers.join(' · ')}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Edit controls */}
      {isEditing && (
        <View style={styles.editControls}>
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={() => { setEditText(mnemonic.storyText); setIsEditing(false) }}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.saveBtn, isSaving && styles.disabled]}
            onPress={handleSave}
            disabled={isSaving}
          >
            <Text style={styles.saveText}>{isSaving ? 'Saving…' : 'Save'}</Text>
          </TouchableOpacity>
        </View>
      )}

    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hookCard: { borderColor: colors.primary + '55' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  systemBadge: { backgroundColor: colors.accent + '22' },
  userBadge: { backgroundColor: colors.primary + '22' },
  hookBadge: { backgroundColor: colors.primary + '22' },
  typeLabel: { ...typography.caption, fontWeight: '700' },
  systemLabel: { color: colors.accent },
  userLabel: { color: colors.primary },
  depthBadge: {
    backgroundColor: colors.bgSurface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  depthText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  locationBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },
  locationText: { ...typography.caption, color: colors.textMuted, flexShrink: 1 },
  actions: { flexDirection: 'row', gap: spacing.xs },
  iconBtn: { padding: spacing.xs },
  story: { ...typography.body, color: colors.textPrimary, lineHeight: 24 },
  editInput: {
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.md,
    padding: spacing.sm,
    minHeight: 80,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: colors.primary + '55',
  },
  editControls: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  cancelBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  cancelText: { ...typography.bodySmall, color: colors.textMuted },
  saveBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
  },
  saveText: { ...typography.bodySmall, color: '#fff', fontWeight: '600' },
  disabled: { opacity: 0.5 },
  layerStack: { gap: spacing.sm },
  layer: { flexDirection: 'row', gap: spacing.sm },
  // A rail rather than a bullet: the layers are one continuing thread, not a
  // list of separate items.
  layerRail: { width: 2, borderRadius: 1, backgroundColor: colors.primary + '44' },
  layerBody: { flex: 1, gap: 2 },
  layerSource: {
    ...typography.caption,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  layerAnswer: { ...typography.bodySmall, color: colors.textSecondary, lineHeight: 20 },
  photoContainer: { position: 'relative', borderRadius: radius.md, overflow: 'hidden' },
  photo: { width: '100%', height: 180, borderRadius: radius.md },
  removePhotoBtn: { position: 'absolute', top: spacing.xs, right: spacing.xs },
  addPhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignSelf: 'flex-start',
  },
  addPhotoText: { ...typography.caption, color: colors.textMuted },
})
