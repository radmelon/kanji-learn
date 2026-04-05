import { useState, useCallback, useRef, useEffect } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, SafeAreaView,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { api } from '../src/lib/api'
import { colors, spacing, radius, typography } from '../src/theme'

// ─── Types ────────────────────────────────────────────────────────────────────

type JlptLevel = 'N5' | 'N4' | 'N3' | 'N2' | 'N1'
type SrsStatus = 'unseen' | 'learning' | 'reviewing' | 'remembered' | 'burned'

interface KanjiBrowseItem {
  id: number
  character: string
  jlptLevel: JlptLevel
  meanings: string[]
  srsStatus: SrsStatus
}

interface BrowsePage {
  items: KanjiBrowseItem[]
  total: number
  offset: number
  limit: number
}

const JLPT_LEVELS: JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1']
const SRS_STATUSES: SrsStatus[] = ['unseen', 'learning', 'reviewing', 'remembered', 'burned']

const JLPT_COLORS: Record<JlptLevel, string> = {
  N5: colors.n5,
  N4: colors.n4,
  N3: colors.n3,
  N2: colors.n2,
  N1: colors.n1,
}

const STATUS_COLORS: Record<SrsStatus, string> = {
  unseen:     colors.unseen,
  learning:   colors.learning,
  reviewing:  colors.reviewing,
  remembered: colors.remembered,
  burned:     colors.burned,
}

const STATUS_LABELS: Record<SrsStatus, string> = {
  unseen:     'Unseen',
  learning:   'Learning',
  reviewing:  'Reviewing',
  remembered: 'Remembered',
  burned:     'Burned',
}

const PAGE_SIZE = 50

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function BrowseScreen() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [level, setLevel] = useState<JlptLevel | null>(null)
  const [status, setStatus] = useState<SrsStatus | null>(null)
  const [items, setItems] = useState<KanjiBrowseItem[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const offsetRef = useRef(0)
  const hasMoreRef = useRef(true)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const buildUrl = useCallback((offset: number, q: string, lvl: JlptLevel | null, st: SrsStatus | null) => {
    const params = new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE) })
    if (q.trim()) params.set('search', q.trim())
    if (lvl) params.set('level', lvl)
    if (st) params.set('status', st)
    return `/v1/kanji/browse?${params}`
  }, [])

  const loadPage = useCallback(async (offset: number, q: string, lvl: JlptLevel | null, st: SrsStatus | null, append: boolean) => {
    if (append) setIsLoadingMore(true)
    else setIsLoading(true)

    try {
      const data = await api.get<BrowsePage>(buildUrl(offset, q, lvl, st))
      setTotal(data.total)
      setItems((prev) => append ? [...prev, ...data.items] : data.items)
      offsetRef.current = offset + data.items.length
      hasMoreRef.current = offset + data.items.length < data.total
    } finally {
      if (append) setIsLoadingMore(false)
      else setIsLoading(false)
    }
  }, [buildUrl])

  const reload = useCallback((q: string, lvl: JlptLevel | null, st: SrsStatus | null) => {
    offsetRef.current = 0
    hasMoreRef.current = true
    loadPage(0, q, lvl, st, false)
  }, [loadPage])

  // Initial load
  useEffect(() => { reload('', null, null) }, [])

  const onSearchChange = (text: string) => {
    setSearch(text)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => reload(text, level, status), 300)
  }

  const onLevelPress = (lvl: JlptLevel) => {
    const next = level === lvl ? null : lvl
    setLevel(next)
    reload(search, next, status)
  }

  const onStatusPress = (st: SrsStatus) => {
    const next = status === st ? null : st
    setStatus(next)
    reload(search, level, next)
  }

  const onEndReached = () => {
    if (!isLoadingMore && hasMoreRef.current) {
      loadPage(offsetRef.current, search, level, status, true)
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-down" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Browse Kanji</Text>
        <Text style={styles.count}>{total.toLocaleString()}</Text>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={colors.textMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={onSearchChange}
          placeholder="Search character or meaning…"
          placeholderTextColor={colors.textMuted}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => { setSearch(''); reload('', level, status) }} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* JLPT filter */}
      <View style={styles.filterRow}>
        {JLPT_LEVELS.map((lvl) => {
          const active = level === lvl
          const lvlColor = JLPT_COLORS[lvl]
          return (
            <TouchableOpacity
              key={lvl}
              style={[styles.pill, active && { backgroundColor: lvlColor + '33', borderColor: lvlColor }]}
              onPress={() => onLevelPress(lvl)}
            >
              <Text style={[styles.pillText, active && { color: lvlColor, fontWeight: '700' }]}>{lvl}</Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {/* SRS status filter */}
      <View style={styles.filterRow}>
        {SRS_STATUSES.map((st) => {
          const active = status === st
          const stColor = STATUS_COLORS[st]
          return (
            <TouchableOpacity
              key={st}
              style={[styles.pill, active && { backgroundColor: stColor + '33', borderColor: stColor }]}
              onPress={() => onStatusPress(st)}
            >
              <Text style={[styles.pillText, active && { color: stColor, fontWeight: '700' }]}>{STATUS_LABELS[st]}</Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {/* List */}
      {isLoading ? (
        <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: spacing.xxl }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          numColumns={2}
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={styles.columnWrap}
          renderItem={({ item }) => <KanjiCard item={item} />}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.3}
          ListFooterComponent={isLoadingMore ? <ActivityIndicator color={colors.primary} style={{ padding: spacing.md }} /> : null}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No kanji found</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  )
}

// ─── KanjiCard ────────────────────────────────────────────────────────────────

function KanjiCard({ item }: { item: KanjiBrowseItem }) {
  const statusColor = STATUS_COLORS[item.srsStatus]
  const meaning = item.meanings[0] ?? ''

  return (
    <View style={cardStyles.container}>
      <View style={cardStyles.top}>
        <Text style={cardStyles.character}>{item.character}</Text>
        <View style={[cardStyles.statusDot, { backgroundColor: statusColor }]} />
      </View>
      <Text style={cardStyles.meaning} numberOfLines={1}>{meaning}</Text>
    </View>
  )
}

const cardStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  character: { ...typography.h1, color: colors.textPrimary, fontSize: 36 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  meaning: { ...typography.caption, color: colors.textSecondary },
})

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  backBtn: { padding: 4 },
  title: { ...typography.h2, color: colors.textPrimary, flex: 1 },
  count: { ...typography.caption, color: colors.textMuted },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  searchIcon: { marginRight: 2 },
  searchInput: {
    flex: 1,
    ...typography.body,
    color: colors.textPrimary,
    paddingVertical: 4,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
    flexWrap: 'wrap',
  },
  pill: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  pillText: { ...typography.caption, color: colors.textMuted },
  listContent: { padding: spacing.md, paddingTop: spacing.sm },
  columnWrap: { gap: spacing.sm, marginBottom: spacing.sm },
  empty: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyText: { ...typography.body, color: colors.textMuted },
})
