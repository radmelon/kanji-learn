import { useState, useCallback, useEffect } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Switch, ActivityIndicator, Alert, RefreshControl, Share,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useAuthStore } from '../../src/stores/auth.store'
import { api } from '../../src/lib/api'
import { storage } from '../../src/lib/storage'
import { useNetworkStatus } from '../../src/hooks/useNetworkStatus'
import { OfflineBanner } from '../../src/components/ui/OfflineBanner'
import { useSocial } from '../../src/hooks/useSocial'
import type { SearchResult } from '../../src/hooks/useSocial'

const PROFILE_CACHE_KEY = 'kl:profile_cache'
import { colors, spacing, radius, typography } from '../../src/theme'

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserProfile {
  id: string
  displayName: string | null
  dailyGoal: number
  notificationsEnabled: boolean
  timezone: string
  reminderHour: number
}

// ─── Daily goal options ───────────────────────────────────────────────────────

const GOAL_OPTIONS = [5, 10, 15, 20, 30, 50] as const

// ─── Profile Screen ───────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const router = useRouter()
  const { user, signOut } = useAuthStore()

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isOffline, setIsOffline] = useState(false)
  const { isOnline } = useNetworkStatus()

  // Editable fields — local state, saved on blur / toggle
  const [displayName, setDisplayName] = useState('')
  const [dailyGoal, setDailyGoal] = useState(20)
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)
  const [reminderHour, setReminderHour] = useState(20)

  // Social
  const { friends, pendingRequests, isSearching, loadAll, searchByEmail, sendRequest, respondToRequest, removeFriend } = useSocial()
  const [friendSearch, setFriendSearch] = useState('')
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)

  // ── Load profile ─────────────────────────────────────────────────────────

  const applyProfile = useCallback((data: UserProfile) => {
    setProfile(data)
    setDisplayName(data.displayName ?? '')
    setDailyGoal(data.dailyGoal)
    setNotificationsEnabled(data.notificationsEnabled)
    setReminderHour(data.reminderHour ?? 20)
  }, [])

  const loadProfile = useCallback(async () => {
    setIsLoading(true)
    setIsOffline(false)

    // Show cache immediately
    const cached = await storage.getItem<{ data: UserProfile }>(PROFILE_CACHE_KEY)
    if (cached?.data) applyProfile(cached.data)

    try {
      const data = await api.get<UserProfile>('/v1/user/profile')
      applyProfile(data)
      await storage.setItem(PROFILE_CACHE_KEY, { data })
    } catch {
      if (cached?.data) {
        setIsOffline(true)
      } else {
        // Profile may not exist yet for brand-new users — use auth metadata
        const name = user?.user_metadata?.display_name ?? ''
        setDisplayName(name)
      }
    } finally {
      setIsLoading(false)
    }
  }, [user, applyProfile])

  useEffect(() => {
    loadProfile()
  }, [loadProfile])

  // ── Save helpers ─────────────────────────────────────────────────────────

  const save = useCallback(async (patch: Partial<{
    displayName: string
    dailyGoal: number
    notificationsEnabled: boolean
    reminderHour: number
  }>) => {
    setIsSaving(true)
    try {
      const updated = await api.patch<UserProfile>('/v1/user/profile', patch)
      setProfile(updated)
    } catch {
      Alert.alert('Save failed', 'Could not update your profile. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }, [])

  const handleNameBlur = useCallback(() => {
    if (!profile) return
    const trimmed = displayName.trim()
    if (trimmed === (profile.displayName ?? '')) return
    save({ displayName: trimmed || undefined })
  }, [displayName, profile, save])

  const handleGoalSelect = useCallback((goal: number) => {
    setDailyGoal(goal)
    save({ dailyGoal: goal })
  }, [save])

  const handleNotificationsToggle = useCallback((value: boolean) => {
    setNotificationsEnabled(value)
    save({ notificationsEnabled: value })
  }, [save])

  const handleReminderHour = useCallback((hour: number) => {
    setReminderHour(hour)
    save({ reminderHour: hour })
  }, [save])

  const handleFriendSearch = useCallback(async () => {
    const email = friendSearch.trim()
    if (!email) return
    setSearchError(null)
    setSearchResult(null)
    try {
      const result = await searchByEmail(email)
      setSearchResult(result)
      if (!result.user) setSearchError(`No user found for "${email}". You can invite them below.`)
    } catch {
      setSearchError('Search failed. Please try again.')
    }
  }, [friendSearch, searchByEmail])

  const handleSendRequest = useCallback(async (addresseeId: string) => {
    try {
      await sendRequest(addresseeId)
      setSearchResult(null)
      setFriendSearch('')
      Alert.alert('Request sent!', 'They\'ll see your invite next time they open the app.')
    } catch {
      Alert.alert('Error', 'Could not send request. They may already be your study mate.')
    }
  }, [sendRequest])

  const handleInviteExternal = useCallback(async () => {
    await Share.share({
      message: `Hey! I'm using Kanji Learn to study Japanese kanji. Join me as a study mate! Download it and look me up by email: ${user?.email}`,
    })
  }, [user?.email])

  const handleRemoveFriend = useCallback((friendId: string, name: string) => {
    Alert.alert(`Remove ${name || 'study mate'}?`, 'You can always add them back later.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try { await removeFriend(friendId) }
        catch { Alert.alert('Error', 'Could not remove study mate.') }
      }},
    ])
  }, [removeFriend])

  const handleSignOut = useCallback(() => {
    Alert.alert(
      'Sign out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: () => signOut(),
        },
      ]
    )
  }, [signOut])

  // ── Loading ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
      </SafeAreaView>
    )
  }

  const email = user?.email ?? ''
  const initials = (displayName || email).slice(0, 2).toUpperCase()

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={loadProfile} tintColor={colors.primary} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.screenTitle}>Profile</Text>
          {isSaving && <ActivityIndicator size="small" color={colors.textMuted} />}
        </View>

        {(isOffline || !isOnline) && (
          <OfflineBanner message="Showing cached profile" staleLabel="Read-only while offline" />
        )}

        {/* Avatar + identity */}
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.email}>{email}</Text>
        </View>

        {/* Display name */}
        <Section title="Display Name">
          <TextInput
            style={styles.textInput}
            value={displayName}
            onChangeText={setDisplayName}
            onBlur={handleNameBlur}
            placeholder="Your name"
            placeholderTextColor={colors.textMuted}
            returnKeyType="done"
            maxLength={50}
          />
        </Section>

        {/* Daily goal */}
        <Section title="Daily Review Goal" subtitle="Cards per day">
          <View style={styles.goalGrid}>
            {GOAL_OPTIONS.map((g) => (
              <TouchableOpacity
                key={g}
                style={[styles.goalChip, dailyGoal === g && styles.goalChipActive]}
                onPress={() => handleGoalSelect(g)}
                activeOpacity={0.7}
              >
                <Text style={[styles.goalChipText, dailyGoal === g && styles.goalChipTextActive]}>
                  {g}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Section>

        {/* Notifications */}
        <Section title="Notifications">
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Ionicons name="notifications-outline" size={20} color={colors.textSecondary} />
              <View>
                <Text style={styles.rowLabel}>Daily reminder</Text>
                <Text style={styles.rowSub}>Get nudged to hit your daily goal</Text>
              </View>
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={handleNotificationsToggle}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
          {notificationsEnabled && (
            <View style={styles.reminderTimeRow}>
              <Ionicons name="time-outline" size={18} color={colors.textMuted} />
              <Text style={styles.reminderTimeLabel}>Remind me at</Text>
              <View style={styles.reminderHourPills}>
                {[17, 18, 19, 20, 21, 22].map((h) => {
                  const label = h >= 12 ? `${h === 12 ? 12 : h - 12}pm` : `${h}am`
                  const active = reminderHour === h
                  return (
                    <TouchableOpacity
                      key={h}
                      style={[styles.reminderPill, active && styles.reminderPillActive]}
                      onPress={() => handleReminderHour(h)}
                    >
                      <Text style={[styles.reminderPillText, active && styles.reminderPillTextActive]}>{label}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </View>
          )}
        </Section>

        {/* App links */}
        <Section title="App">
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push('/placement' as never)}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <Ionicons name="trophy-outline" size={20} color={colors.textSecondary} />
              <View>
                <Text style={styles.rowLabel}>Placement Test</Text>
                <Text style={styles.rowSub}>Identify kanji you already know</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push('/about' as never)}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} />
              <Text style={styles.rowLabel}>About & Licences</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </Section>

        {/* Study Mates */}
        <Section title="Study Mates">
          {/* Search */}
          <View style={styles.searchRow}>
            <TextInput
              style={[styles.textInput, { flex: 1 }]}
              placeholder="Search by email address…"
              placeholderTextColor={colors.textMuted}
              value={friendSearch}
              onChangeText={(t) => { setFriendSearch(t); setSearchResult(null); setSearchError(null) }}
              onSubmitEditing={handleFriendSearch}
              returnKeyType="search"
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <TouchableOpacity
              style={styles.searchBtn}
              onPress={handleFriendSearch}
              disabled={isSearching || !friendSearch.trim()}
            >
              {isSearching
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="search" size={18} color="#fff" />
              }
            </TouchableOpacity>
          </View>

          {/* Search result */}
          {searchResult?.user && (
            <View style={styles.searchResultCard}>
              <View style={styles.rowLeft}>
                <Ionicons name="person-circle-outline" size={32} color={colors.primary} />
                <View>
                  <Text style={styles.rowLabel}>{searchResult.user.displayName ?? searchResult.user.email}</Text>
                  <Text style={styles.rowSub}>{searchResult.user.email}</Text>
                </View>
              </View>
              {searchResult.friendshipStatus === 'accepted' ? (
                <Text style={[styles.rowSub, { color: colors.success }]}>Already mates</Text>
              ) : searchResult.friendshipStatus === 'pending' ? (
                <Text style={[styles.rowSub, { color: colors.warning }]}>Request pending</Text>
              ) : (
                <TouchableOpacity
                  style={styles.addBtn}
                  onPress={() => handleSendRequest(searchResult.user!.id)}
                >
                  <Ionicons name="person-add-outline" size={14} color="#fff" />
                  <Text style={styles.addBtnText}>Invite</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Not found */}
          {searchError && (
            <View style={styles.searchErrorBox}>
              <Text style={styles.rowSub}>{searchError}</Text>
              {!searchResult?.user && friendSearch.trim() && (
                <TouchableOpacity style={[styles.addBtn, { marginTop: spacing.xs }]} onPress={handleInviteExternal}>
                  <Ionicons name="share-outline" size={14} color="#fff" />
                  <Text style={styles.addBtnText}>Send invite</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Pending requests */}
          {pendingRequests.length > 0 && (
            <View style={{ marginTop: spacing.sm }}>
              <Text style={styles.subSectionTitle}>Pending invites</Text>
              {pendingRequests.map((r) => (
                <View key={r.id} style={[styles.searchResultCard, { marginTop: spacing.xs }]}>
                  <View style={styles.rowLeft}>
                    <Ionicons name="person-circle-outline" size={28} color={colors.accent} />
                    <View>
                      <Text style={styles.rowLabel}>{r.requesterName ?? r.requesterEmail ?? 'Someone'}</Text>
                      <Text style={styles.rowSub}>wants to study together</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                    <TouchableOpacity style={styles.acceptBtn} onPress={() => respondToRequest(r.id, 'accept')}>
                      <Text style={styles.acceptBtnText}>Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => respondToRequest(r.id, 'decline')}>
                      <Ionicons name="close-circle-outline" size={24} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Friends list */}
          {friends.length > 0 ? (
            <View style={{ marginTop: spacing.sm }}>
              <Text style={styles.subSectionTitle}>Your mates ({friends.length})</Text>
              {friends.map((f) => (
                <View key={f.id} style={[styles.searchResultCard, { marginTop: spacing.xs }]}>
                  <View style={styles.rowLeft}>
                    <Ionicons name="person-circle-outline" size={28} color={colors.primary} />
                    <View>
                      <Text style={styles.rowLabel}>{f.displayName ?? f.email}</Text>
                      {f.displayName && <Text style={styles.rowSub}>{f.email}</Text>}
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => handleRemoveFriend(f.id, f.displayName ?? '')}>
                    <Ionicons name="person-remove-outline" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.rowSub, { marginTop: spacing.sm, textAlign: 'center' }]}>
              No study mates yet — search above to add one!
            </Text>
          )}
        </Section>

        {/* Sign out */}
        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.8}>
          <Ionicons name="log-out-outline" size={18} color={colors.error} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  )
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  screenTitle: { ...typography.h2, color: colors.textPrimary },

  // Avatar
  avatarSection: { alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.sm },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.primary + '22',
    borderWidth: 2, borderColor: colors.primary + '44',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { ...typography.h1, color: colors.primary },
  email: { ...typography.bodySmall, color: colors.textMuted },

  // Section
  section: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sectionTitle: { ...typography.bodySmall, color: colors.textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  sectionSubtitle: { ...typography.caption, color: colors.textMuted },
  sectionBody: { padding: spacing.md },

  // Text input
  textInput: {
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },

  // Goal chips
  goalGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  goalChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    minWidth: 52,
    alignItems: 'center',
  },
  goalChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '22',
  },
  goalChipText: { ...typography.body, color: colors.textSecondary, fontWeight: '600' },
  goalChipTextActive: { color: colors.primary },

  // Row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  rowLabel: { ...typography.body, color: colors.textPrimary },
  rowSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  // Reminder time picker
  reminderTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexWrap: 'wrap',
  },
  reminderTimeLabel: { ...typography.bodySmall, color: colors.textSecondary },
  reminderHourPills: { flexDirection: 'row', gap: spacing.xs, flex: 1, flexWrap: 'wrap' },
  reminderPill: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  reminderPillActive: { backgroundColor: colors.primary + '22', borderColor: colors.primary },
  reminderPillText: { ...typography.caption, color: colors.textMuted },
  reminderPillTextActive: { color: colors.primary, fontWeight: '700' },

  // Study Mates
  searchRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  searchBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 40,
  },
  searchResultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  subSectionTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  searchErrorBox: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  addBtnText: { ...typography.caption, color: '#fff', fontWeight: '600' },
  acceptBtn: {
    backgroundColor: colors.success + '22',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.success + '55',
  },
  acceptBtnText: { ...typography.caption, color: colors.success, fontWeight: '600' },

  // Sign out
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.error + '44',
    backgroundColor: colors.error + '11',
    marginTop: spacing.sm,
  },
  signOutText: { ...typography.body, color: colors.error, fontWeight: '600' },
})
