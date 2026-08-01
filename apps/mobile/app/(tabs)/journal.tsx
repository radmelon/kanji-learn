import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, Modal, ActivityIndicator, RefreshControl, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useMnemonics, useUserHooks } from '../../src/hooks/useMnemonics'
import type { Mnemonic, UserHook } from '../../src/hooks/useMnemonics'
import { api } from '../../src/lib/api'
import { MnemonicCard } from '../../src/components/mnemonics/MnemonicCard'
import { colors, spacing, radius, typography } from '../../src/theme'
import { journalListState } from '../../src/lib/journal-list-state'
import { useNotebookStore } from '../../src/stores/notebook.store'
import { NotebookBody } from '../../src/components/notebook/NotebookBody'
import type { NotebookEntry, NotebookSection } from '@kanji-learn/shared'

// ─── Buddy (formerly the Mnemonic Journal) ─────────────────────────────────
// The tab now opens on the shared notebook: the agreement, experiments,
// observations, settled decisions and tutor notes assembled by
// `assembleNotebook` and rendered by `NotebookBody`. "Your hooks" — the old
// Journal — stays mounted below it, unchanged in behaviour: hooks have no
// live/archive split and no supersede chain, so pulling them through the
// notebook assembly would mean rebuilding them to gain nothing (Task 8 brief).
//
// The 30-day refresh queue that used to be the default hooks view is retired
// (parent spec §10.4) — a hook is now kept alive by the reinforcement loop,
// not by a calendar.

const INFO_JOURNAL = [
  {
    title: "Buddy's notebook",
    body: "This is the shared record of what you and Buddy have agreed, noticed, and settled together — plus anything your tutor has left you.",
  },
  {
    title: 'Your hooks',
    body: "A hook is a memory story you built yourself — anchored to where you were and what you noticed. Search a kanji to see its hook, the threads you've added, and where it was built.",
  },
  {
    title: 'Going deeper',
    body: "When a hook stops working, Buddy offers to add another thread rather than replace it. Nothing you've written is ever discarded — a hook only accumulates.",
  },
]

const INFO_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 }

/** The all-hooks list carries the kanji identity; the per-kanji search does
 *  not (the character is already in the search box). */
const isUserHook = (m: Mnemonic | UserHook): m is UserHook => 'kanjiCharacter' in m

/** Only these two notebook sections are learner-composed prose (spec — the
 *  agreement/experiment are projections of buddy_commitments, tutor notes are
 *  read-only here, and hooks live in their own section below). Any other
 *  section key is a no-op tap rather than a broken write. */
const NOTEBOOK_KIND_BY_SECTION: Partial<Record<NotebookSection['key'], 'observation' | 'decision'>> = {
  observations: 'observation',
  settled: 'decision',
}

interface NotebookEntryModalState {
  visible: boolean
  mode: 'add' | 'edit'
  kind: 'observation' | 'decision' | null
  entryId: string | null
  text: string
}

const CLOSED_ENTRY_MODAL: NotebookEntryModalState = {
  visible: false, mode: 'add', kind: null, entryId: null, text: '',
}

export default function Journal() {
  const [selectedKanjiId, setSelectedKanjiId] = useState<number | null>(null)
  const [kanjiSearch, setKanjiSearch] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [composeVisible, setComposeVisible] = useState(false)
  const [composeText, setComposeText] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const [activeInfo, setActiveInfo] = useState<string | null>(null)

  const toggleInfo = useCallback((id: string) => {
    setActiveInfo((prev) => (prev === id ? null : id))
  }, [])

  // ─── Notebook ──────────────────────────────────────────────────────────
  const {
    hasLoaded: notebookLoaded,
    error: notebookError,
    view: notebookView,
    load: loadNotebook,
    addEntry: addNotebookEntry,
    editEntry: editNotebookEntry,
    deleteEntry: deleteNotebookEntry,
  } = useNotebookStore()

  useEffect(() => {
    loadNotebook()
  }, [loadNotebook])

  const [entryModal, setEntryModal] = useState<NotebookEntryModalState>(CLOSED_ENTRY_MODAL)
  const [entrySaving, setEntrySaving] = useState(false)

  const handleNotebookAdd = useCallback((sectionKey: NotebookSection['key']) => {
    const kind = NOTEBOOK_KIND_BY_SECTION[sectionKey]
    if (!kind) return
    setEntryModal({ visible: true, mode: 'add', kind, entryId: null, text: '' })
  }, [])

  const handleNotebookEdit = useCallback((entry: NotebookEntry) => {
    setEntryModal({ visible: true, mode: 'edit', kind: null, entryId: entry.id, text: entry.body })
  }, [])

  const handleNotebookDelete = useCallback((entry: NotebookEntry) => {
    Alert.alert('Remove this?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => { void deleteNotebookEntry(entry.id) },
      },
    ])
  }, [deleteNotebookEntry])

  const handleEntrySave = useCallback(async () => {
    if (!entryModal.text.trim()) return
    setEntrySaving(true)
    try {
      if (entryModal.mode === 'add' && entryModal.kind) {
        await addNotebookEntry(entryModal.kind, entryModal.text.trim())
      } else if (entryModal.mode === 'edit' && entryModal.entryId) {
        await editNotebookEntry(entryModal.entryId, entryModal.text.trim())
      }
      // addEntry/editEntry swallow their own failures into store.error rather
      // than throwing (notebook.store.ts) — read it back rather than assuming
      // success, or a failed save would silently close the modal.
      if (!useNotebookStore.getState().error) {
        setEntryModal(CLOSED_ENTRY_MODAL)
      }
    } finally {
      setEntrySaving(false)
    }
  }, [entryModal, addNotebookEntry, editNotebookEntry])

  // ─── Hooks ("Your hooks") ──────────────────────────────────────────────
  // kanjiId=0 disables loads until a kanji is selected.
  const {
    mnemonics,
    isLoading,
    load,
    save,
    update,
    updatePhoto,
    remove,
  } = useMnemonics(selectedKanjiId ?? 0)

  // B-211: the Journal's default is now every hook the learner has written,
  // newest first. Search narrows to one kanji; it is a filter, not the only way in.
  const { hooks, isLoading: hooksLoading, hasLoaded: hooksLoaded, load: loadHooks } = useUserHooks()

  useEffect(() => {
    if (selectedKanjiId) load()
  }, [selectedKanjiId])

  useEffect(() => {
    loadHooks()
  }, [loadHooks])

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

  const displayItems = selectedKanjiId ? mnemonics : hooks
  const listLoading = selectedKanjiId ? isLoading : hooksLoading
  const refreshList = selectedKanjiId ? load : loadHooks
  // B-227. The three body states are exhaustive by construction — see
  // src/lib/journal-list-state.ts for why that matters and what broke before.
  const bodyState = journalListState({
    hasSelectedKanji: !!selectedKanjiId,
    hooksLoaded,
    hookCount: hooks.length,
  })
  const showEmptyState = bodyState === 'empty'
  const showLoading = bodyState === 'loading'

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Buddy</Text>
        <InfoButton id="journal" activeInfo={activeInfo} onToggle={toggleInfo} />
      </View>
      {activeInfo === 'journal' && (
        <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.sm }}>
          <InfoPanel sections={INFO_JOURNAL} />
        </View>
      )}

      {/* Cold load with nothing cached yet (B-227's failure mode, repeated
          here deliberately: a store that never leaves hasLoaded false,
          rendered distinctly at each of its three states so this screen
          never appears unbuilt). */}
      {!notebookLoaded && (
        <View style={styles.notebookLoading}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.notebookLoadingText}>Loading Buddy's notebook…</Text>
        </View>
      )}

      {notebookLoaded && notebookError && (
        <View style={styles.notebookErrorBanner}>
          <Ionicons name="cloud-offline-outline" size={18} color={colors.error} />
          <Text style={styles.notebookErrorText}>{notebookError}</Text>
        </View>
      )}

      {/* NotebookBody's own root carries `flex: 1` (styled for a screen
          where it's the only body). As a direct child of this column it
          would greedily claim every pixel of remaining height and push
          "Your hooks" off the bottom of the screen — this plain wrapping
          View (no flex of its own) gives Yoga an undefined-height parent,
          so NotebookBody sizes to its content instead of growing. */}
      {notebookLoaded && notebookView && (
        <View>
          <NotebookBody
            view={notebookView}
            onAdd={handleNotebookAdd}
            onEdit={handleNotebookEdit}
            onDelete={handleNotebookDelete}
          />
        </View>
      )}

      <Text style={styles.sectionTitle}>Your hooks</Text>

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

      {/* Cold load with nothing cached. Mirrors the Study tab's
          "Loading reviews…" pattern so the tab never renders empty (B-227). */}
      {showLoading && (
        <View style={styles.emptyState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.emptySubtitle}>Loading your hooks…</Text>
        </View>
      )}

      {/* Genuinely no hooks yet — not "nothing selected". The old copy said
          "Search a kanji" because listing them was impossible (B-211). */}
      {showEmptyState && (
        <View style={styles.emptyState}>
          <Ionicons name="journal-outline" size={48} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No hooks yet</Text>
          <Text style={styles.emptySubtitle}>
            Build one from a kanji you keep forgetting and it will appear here
          </Text>
        </View>
      )}

      {/* List */}
      <FlatList
        data={displayItems}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={listLoading}
            onRefresh={refreshList}
            tintColor={colors.primary}
          />
        }
        renderItem={({ item }) => {
          // In the all-hooks list every card is a different kanji, and
          // MnemonicCard renders only the story — so without this the list is
          // a wall of prose with nothing saying what each entry is for.
          const hook = isUserHook(item) ? item : null
          return (
            <View style={styles.hookGroup}>
              {hook && (
                <View style={styles.hookHeading}>
                  <Text style={styles.hookKanji}>{hook.kanjiCharacter}</Text>
                  <View style={styles.hookHeadingText}>
                    <Text style={styles.hookMeaning} numberOfLines={1}>
                      {hook.kanjiMeanings.slice(0, 3).join(', ')}
                    </Text>
                    {hook.layerCount > 1 && (
                      <Text style={styles.hookLayers}>{hook.layerCount} layers</Text>
                    )}
                  </View>
                </View>
              )}
              <MnemonicCard
                mnemonic={item}
                onUpdate={update}
                onUpdatePhoto={updatePhoto}
                onDelete={remove}
              />
            </View>
          )
        }}
        ListEmptyComponent={
          listLoading || !selectedKanjiId ? null : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No hook yet</Text>
              <Text style={styles.emptySubtitle}>
                Open this kanji from Browse and tap “Build a hook”, or write your own here
              </Text>
            </View>
          )
        }
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      />

      {/* Compose modal — hooks */}
      <Modal visible={composeVisible} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
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
        </KeyboardAvoidingView>
      </Modal>

      {/* Compose modal — notebook entries (observations / settled decisions) */}
      <Modal visible={entryModal.visible} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {entryModal.mode === 'edit' ? 'Edit note' : 'Add a note'}
              </Text>
              <TouchableOpacity onPress={() => setEntryModal(CLOSED_ENTRY_MODAL)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.composeInput}
              placeholder="What did you notice, or what did you decide?"
              placeholderTextColor={colors.textMuted}
              value={entryModal.text}
              onChangeText={(text) => setEntryModal((prev) => ({ ...prev, text }))}
              multiline
              autoFocus
            />
            <TouchableOpacity
              style={[styles.saveBtn, (!entryModal.text.trim() || entrySaving) && styles.disabled]}
              onPress={handleEntrySave}
              disabled={!entryModal.text.trim() || entrySaving}
            >
              <Text style={styles.saveBtnText}>{entrySaving ? 'Saving…' : 'Save note'}</Text>
            </TouchableOpacity>
          </View>
        </View>
        </KeyboardAvoidingView>
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
  notebookLoading: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl, gap: spacing.md },
  notebookLoadingText: { ...typography.bodySmall, color: colors.textMuted },
  notebookErrorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.error + '18', borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.error + '44',
    marginHorizontal: spacing.md, marginTop: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  notebookErrorText: { ...typography.bodySmall, color: colors.error, flexShrink: 1 },
  searchRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  searchInput: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.bgCard, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border },
  searchText: { ...typography.body, color: colors.textPrimary, flex: 1 },
  composeBtn: { backgroundColor: colors.primary, width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  generateRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  genBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.bgCard, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  genBtnText: { ...typography.bodySmall, color: colors.accent },
  sectionTitle: { ...typography.h3, color: colors.textPrimary, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },
  hookGroup: { gap: spacing.xs, marginBottom: spacing.md },
  hookHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hookKanji: { fontSize: 32, color: colors.textPrimary },
  hookHeadingText: { flex: 1 },
  hookMeaning: { ...typography.bodySmall, color: colors.textSecondary },
  hookLayers: { ...typography.caption, color: colors.textMuted },
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

// ─── InfoButton ───────────────────────────────────────────────────────────────

interface InfoSection { title?: string; body: string }

function InfoButton({
  id,
  activeInfo,
  onToggle,
}: {
  id: string
  activeInfo: string | null
  onToggle: (id: string) => void
}) {
  const isOpen = activeInfo === id
  return (
    <TouchableOpacity onPress={() => onToggle(id)} hitSlop={INFO_HIT_SLOP} activeOpacity={0.7}>
      <Ionicons
        name={isOpen ? 'chevron-up-circle-outline' : 'information-circle-outline'}
        size={18}
        color={isOpen ? colors.info : colors.textMuted}
      />
    </TouchableOpacity>
  )
}

// ─── InfoPanel ────────────────────────────────────────────────────────────────

function InfoPanel({ sections }: { sections: InfoSection[] }) {
  return (
    <View style={infoStyles.panel}>
      {sections.map((s, i) => (
        <View key={i} style={[infoStyles.section, i > 0 && infoStyles.sectionSpaced]}>
          {s.title !== undefined && (
            <Text style={infoStyles.sectionTitle}>{s.title}</Text>
          )}
          <Text style={infoStyles.sectionBody}>{s.body}</Text>
        </View>
      ))}
    </View>
  )
}

const infoStyles = StyleSheet.create({
  panel: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.info + '44',
    padding: spacing.md,
  },
  section: {},
  sectionSpaced: { marginTop: spacing.sm },
  sectionTitle: {
    ...typography.caption,
    color: colors.info,
    fontWeight: '700',
    marginBottom: 3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionBody: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 18,
  },
})
