import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, Modal, ActivityIndicator, RefreshControl, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useMnemonics, useRefreshDue } from '../../src/hooks/useMnemonics'
import { api } from '../../src/lib/api'
import { MnemonicCard } from '../../src/components/mnemonics/MnemonicCard'
import { colors, spacing, radius, typography } from '../../src/theme'
import type { Mnemonic } from '../../src/hooks/useMnemonics'

// ─── Journal Screen ───────────────────────────────────────────────────────────
// Shows mnemonics due for 30-day refresh + a searchable list by kanji character.

export default function Journal() {
  const [selectedKanjiId, setSelectedKanjiId] = useState<number | null>(null)
  const [kanjiSearch, setKanjiSearch] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [composeVisible, setComposeVisible] = useState(false)
  const [composeText, setComposeText] = useState('')
  const [isComposing, setIsComposing] = useState(false)

  const { due, isLoading: dueLoading, load: loadDue } = useRefreshDue()

  // Default to showing refresh-due mnemonics; kanjiId=0 disables individual loads
  const {
    mnemonics,
    isLoading,
    isGenerating,
    load,
    generate,
    save,
    update,
    remove,
    dismissRefresh,
  } = useMnemonics(selectedKanjiId ?? 0)

  useEffect(() => {
    loadDue()
  }, [])

  useEffect(() => {
    if (selectedKanjiId) load()
  }, [selectedKanjiId])

  const handleGenerate = useCallback(
    async (model: 'haiku' | 'sonnet') => {
      if (!selectedKanjiId) return
      try {
        await generate(model)
      } catch {
        Alert.alert('Error', 'Failed to generate mnemonic. Please try again.')
      }
    },
    [selectedKanjiId, generate]
  )

  const handleSave = useCallback(async () => {
    if (!composeText.trim() || !selectedKanjiId) return
    setIsComposing(true)
    try {
      await save(composeText.trim())
      setComposeText('')
      setComposeVisible(false)
    } catch {
      Alert.alert('Error', 'Failed to save mnemonic')
    } finally {
      setIsComposing(false)
    }
  }, [composeText, selectedKanjiId, save])

  // Merge refresh-due with selected kanji mnemonics
  const displayItems: Mnemonic[] =
    selectedKanjiId ? mnemonics : due

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Mnemonic Journal</Text>
        {due.length > 0 && (
          <View style={styles.refreshBadge}>
            <Text style={styles.refreshBadgeText}>{due.length} due</Text>
          </View>
        )}
      </View>

      {/* Search / filter bar */}
      <View style={styles.searchRow}>
        <View style={styles.searchInput}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            style={styles.searchText}
            placeholder="Type a kanji or ID…"
            placeholderTextColor={colors.textMuted}
            value={kanjiSearch}
            onChangeText={setKanjiSearch}
            onSubmitEditing={async () => {
              const trimmed = kanjiSearch.trim()
              if (!trimmed) return
              setSearchError(null)

              // Numeric ID — use directly
              const asNumber = parseInt(trimmed)
              if (!isNaN(asNumber)) {
                setSelectedKanjiId(asNumber)
                return
              }

              // Kanji character — look it up
              setIsSearching(true)
              try {
                const result = await api.get<{ id: number; character: string }>(
                  `/v1/kanji/lookup?character=${encodeURIComponent(trimmed)}`
                )
                setSelectedKanjiId(result.id)
              } catch {
                setSearchError(`"${trimmed}" not found`)
              } finally {
                setIsSearching(false)
              }
            }}
            returnKeyType="search"
          />
          {isSearching ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : kanjiSearch.length > 0 ? (
            <TouchableOpacity onPress={() => { setKanjiSearch(''); setSelectedKanjiId(null); setSearchError(null) }}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        {selectedKanjiId && (
          <TouchableOpacity
            style={styles.composeBtn}
            onPress={() => setComposeVisible(true)}
          >
            <Ionicons name="add" size={20} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      {/* Search error */}
      {searchError && (
        <Text style={styles.searchError}>{searchError}</Text>
      )}

      {/* Generate buttons (visible when kanji selected) */}
      {selectedKanjiId && (
        <View style={styles.generateRow}>
          <TouchableOpacity
            style={[styles.genBtn, isGenerating && styles.disabled]}
            onPress={() => handleGenerate('haiku')}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Ionicons name="sparkles-outline" size={14} color={colors.accent} />
            )}
            <Text style={styles.genBtnText}>Quick (Haiku)</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.genBtn, isGenerating && styles.disabled]}
            onPress={() => handleGenerate('sonnet')}
            disabled={isGenerating}
          >
            <Ionicons name="color-wand-outline" size={14} color={colors.primary} />
            <Text style={[styles.genBtnText, { color: colors.primary }]}>Rich (Sonnet)</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Section title */}
      {!selectedKanjiId && due.length > 0 && (
        <Text style={styles.sectionTitle}>Due for refresh</Text>
      )}
      {!selectedKanjiId && due.length === 0 && !dueLoading && (
        <View style={styles.emptyState}>
          <Ionicons name="journal-outline" size={48} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No mnemonics due</Text>
          <Text style={styles.emptySubtitle}>Search for a kanji to view or create mnemonics</Text>
        </View>
      )}

      {/* List */}
      <FlatList
        data={displayItems}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={isLoading || dueLoading}
            onRefresh={selectedKanjiId ? load : loadDue}
            tintColor={colors.primary}
          />
        }
        renderItem={({ item }) => (
          <MnemonicCard
            mnemonic={item}
            showRefreshPrompt
            onUpdate={update}
            onDelete={remove}
            onDismissRefresh={dismissRefresh}
          />
        )}
        ListEmptyComponent={
          isLoading ? null : selectedKanjiId ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No mnemonics yet</Text>
              <Text style={styles.emptySubtitle}>Generate one above or write your own</Text>
            </View>
          ) : null
        }
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      />

      {/* Compose modal */}
      <Modal visible={composeVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Write a mnemonic</Text>
              <TouchableOpacity onPress={() => setComposeVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.composeInput}
              placeholder="Tell a vivid story that makes this kanji stick…"
              placeholderTextColor={colors.textMuted}
              value={composeText}
              onChangeText={setComposeText}
              multiline
              autoFocus
            />
            <TouchableOpacity
              style={[styles.saveBtn, (!composeText.trim() || isComposing) && styles.disabled]}
              onPress={handleSave}
              disabled={!composeText.trim() || isComposing}
            >
              <Text style={styles.saveBtnText}>{isComposing ? 'Saving…' : 'Save mnemonic'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.sm },
  title: { ...typography.h2, color: colors.textPrimary, flex: 1 },
  refreshBadge: { backgroundColor: colors.warning + '22', paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.full },
  refreshBadgeText: { ...typography.caption, color: colors.warning, fontWeight: '700' },
  searchRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  searchInput: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.bgCard, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border },
  searchText: { ...typography.body, color: colors.textPrimary, flex: 1 },
  composeBtn: { backgroundColor: colors.primary, width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  generateRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  genBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.bgCard, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  genBtnText: { ...typography.bodySmall, color: colors.accent },
  sectionTitle: { ...typography.bodySmall, color: colors.textMuted, paddingHorizontal: spacing.md, paddingBottom: spacing.xs, fontWeight: '600' },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl, gap: spacing.md },
  emptyTitle: { ...typography.h3, color: colors.textSecondary },
  emptySubtitle: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center', paddingHorizontal: spacing.xl },
  disabled: { opacity: 0.4 },
  searchError: { ...typography.bodySmall, color: colors.error ?? '#ef4444', paddingHorizontal: spacing.md, marginTop: -spacing.xs },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.bgCard, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, gap: spacing.md },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { ...typography.h3, color: colors.textPrimary },
  composeInput: { ...typography.body, color: colors.textPrimary, backgroundColor: colors.bgSurface, borderRadius: radius.md, padding: spacing.md, minHeight: 120, textAlignVertical: 'top', borderWidth: 1, borderColor: colors.border },
  saveBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  saveBtnText: { ...typography.h3, color: '#fff' },
})
