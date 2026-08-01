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
import { NotebookEntryModal } from '../../src/components/notebook/NotebookEntryModal'
import type { NotebookEntry, NotebookSection, NotebookView } from '@kanji-learn/shared'

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
//
// Everything above the hook list — the notebook block, the "Your hooks"
// heading, and the search row — lives in the FlatList's ListHeaderComponent
// rather than a plain View column above it. The notebook is unbounded in
// height (cadence line, optional agreement/experiment cards, N sections × M
// entries, tutor notes) and the screen had no scroll container anywhere;
// past a certain amount of notebook content there was no way to reach the
// hook list below it. One FlatList is the one scroll container for the whole
// page, and the list itself stays virtualised (fix pass 1, review finding 1).

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
  /** The kind to create under, when adding (`entry` is null). Unused when editing. */
  kind: 'observation' | 'decision' | null
  /** The entry being edited, or null when adding a new one. */
  entry: NotebookEntry | null
}

const CLOSED_ENTRY_MODAL: NotebookEntryModalState = {
  visible: false, kind: null, entry: null,
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
    setEntryModal({ visible: true, kind, entry: null })
  }, [])

  const handleNotebookEdit = useCallback((entry: NotebookEntry) => {
    setEntryModal({ visible: true, kind: null, entry })
  }, [])

  // Shared by the notebook's own per-entry "Remove" control and the modal's
  // delete affordance — same confirm flow either way; `after` additionally
  // closes the modal when the delete was initiated from inside it.
  const confirmDeleteEntry = useCallback((entry: NotebookEntry, after?: () => void) => {
    Alert.alert('Remove this?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void deleteNotebookEntry(entry.id)
          after?.()
        },
      },
    ])
  }, [deleteNotebookEntry])

  const handleNotebookDelete = useCallback((entry: NotebookEntry) => {
    confirmDeleteEntry(entry)
  }, [confirmDeleteEntry])

  const handleEntryModalDelete = useCallback((entry: NotebookEntry) => {
    confirmDeleteEntry(entry, () => setEntryModal(CLOSED_ENTRY_MODAL))
  }, [confirmDeleteEntry])

  const handleEntryModalCancel = useCallback(() => {
    setEntryModal(CLOSED_ENTRY_MODAL)
  }, [])

  const handleEntrySubmit = useCallback(async (text: string) => {
    if (!text.trim()) return
    setEntrySaving(true)
    try {
      if (entryModal.entry) {
        await editNotebookEntry(entryModal.entry.id, text.trim())
      } else if (entryModal.kind) {
        await addNotebookEntry(entryModal.kind, text.trim())
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

  const handleSubmitSearch = useCallback(async () => {
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
  }, [kanjiSearch])

  const handleClearSearch = useCallback(() => {
    setKanjiSearch('')
    setSelectedKanjiId(null)
    setSearchError(null)
  }, [])

  const handleOpenCompose = useCallback(() => {
    setComposeVisible(true)
  }, [])

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

  // Both branches below correspond to `displayItems` being empty (see
  // journalListState's exhaustiveness note) — the per-kanji "no hook yet"
  // case is the remaining one, gated the same way it always was.
  const listEmptyContent = showLoading ? (
    // Cold load with nothing cached. Mirrors the Study tab's
    // "Loading reviews…" pattern so the tab never renders empty (B-227).
    <View style={styles.emptyState}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={styles.emptySubtitle}>Loading your hooks…</Text>
    </View>
  ) : showEmptyState ? (
    // Genuinely no hooks yet — not "nothing selected". The old copy said
    // "Search a kanji" because listing them was impossible (B-211).
    <View style={styles.emptyState}>
      <Ionicons name="journal-outline" size={48} color={colors.textMuted} />
      <Text style={styles.emptyTitle}>No hooks yet</Text>
      <Text style={styles.emptySubtitle}>
        Build one from a kanji you keep forgetting and it will appear here
      </Text>
    </View>
  ) : listLoading || !selectedKanjiId ? null : (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>No hook yet</Text>
      <Text style={styles.emptySubtitle}>
        Open this kanji from Browse and tap “Build a hook”, or write your own here
      </Text>
    </View>
  )

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

      {/* List — the sole scroll container for the whole screen. Everything
          that used to sit in a plain, non-scrolling column above the list
          (the notebook block, "Your hooks" heading, and search row) now
          lives in ListHeaderComponent, so it scrolls together with the list
          instead of squeezing it toward zero height. JournalListHeader is a
          module-scope component so its identity is stable across renders —
          only its props change — which keeps the search TextInput mounted
          (and therefore focused) while the learner types. */}
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
        ListHeaderComponent={
          <JournalListHeader
            notebookLoaded={notebookLoaded}
            notebookError={notebookError}
            notebookView={notebookView}
            onNotebookAdd={handleNotebookAdd}
            onNotebookEdit={handleNotebookEdit}
            onNotebookDelete={handleNotebookDelete}
            kanjiSearch={kanjiSearch}
            onChangeKanjiSearch={setKanjiSearch}
            onSubmitSearch={handleSubmitSearch}
            isSearching={isSearching}
            searchError={searchError}
            onClearSearch={handleClearSearch}
            selectedKanjiId={selectedKanjiId}
            onOpenCompose={handleOpenCompose}
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
        ListEmptyComponent={listEmptyContent}
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

      {/* Compose/edit modal — notebook entries (observations / settled
          decisions). Extracted to NotebookEntryModal (fix pass 1, review
          finding 2) — a pure presentational component under
          src/components/notebook, with its own tests. */}
      <NotebookEntryModal
        visible={entryModal.visible}
        entry={entryModal.entry}
        saving={entrySaving}
        onSubmit={handleEntrySubmit}
        onDelete={handleEntryModalDelete}
        onCancel={handleEntryModalCancel}
      />
    </SafeAreaView>
  )
}

// ─── JournalListHeader ──────────────────────────────────────────────────────
// Defined outside Journal's render body so its identity never changes across
// renders — only the props do. Passed to FlatList as `ListHeaderComponent`
// (an element, not a fresh factory function) so React reconciles it as an
// update to the same mounted subtree rather than unmounting and remounting
// it — which would otherwise steal focus from the search TextInput on every
// keystroke (review finding 1).

function JournalListHeader({
  notebookLoaded,
  notebookError,
  notebookView,
  onNotebookAdd,
  onNotebookEdit,
  onNotebookDelete,
  kanjiSearch,
  onChangeKanjiSearch,
  onSubmitSearch,
  isSearching,
  searchError,
  onClearSearch,
  selectedKanjiId,
  onOpenCompose,
}: {
  notebookLoaded: boolean
  notebookError: string | null
  notebookView: NotebookView | null
  onNotebookAdd: (sectionKey: NotebookSection['key']) => void
  onNotebookEdit: (entry: NotebookEntry) => void
  onNotebookDelete: (entry: NotebookEntry) => void
  kanjiSearch: string
  onChangeKanjiSearch: (text: string) => void
  onSubmitSearch: () => void
  isSearching: boolean
  searchError: string | null
  onClearSearch: () => void
  selectedKanjiId: number | null
  onOpenCompose: () => void
}) {
  return (
    <View>
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
            onAdd={onNotebookAdd}
            onEdit={onNotebookEdit}
            onDelete={onNotebookDelete}
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
            onChangeText={onChangeKanjiSearch}
            onSubmitEditing={onSubmitSearch}
            returnKeyType="search"
          />
          {isSearching ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : kanjiSearch.length > 0 ? (
            <TouchableOpacity onPress={onClearSearch}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        {selectedKanjiId && (
          <TouchableOpacity
            style={styles.composeBtn}
            onPress={onOpenCompose}
          >
            <Ionicons name="add" size={20} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      {/* Search error */}
      {searchError && (
        <Text style={styles.searchError}>{searchError}</Text>
      )}
    </View>
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
