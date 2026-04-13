import { useState, useCallback, useEffect } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Switch, ActivityIndicator, Alert, RefreshControl, Share,
  FlatList, Modal,
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
import { useLearnerProfile } from '../../src/hooks/useLearnerProfile'
import { COUNTRIES, ONBOARDING_CONTENT } from '../../src/config/onboarding-content'

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
  restDay: number | null  // 0=Sun … 6=Sat, null=no rest day
}

// ─── Daily goal options ───────────────────────────────────────────────────────

const GOAL_OPTIONS = [5, 10, 15, 20, 30, 50] as const

// ─── Profile Screen ───────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const router = useRouter()
  const { user, signOut, setWatchEnabled, forceSyncToWatch, getWatchConnectionStatus } = useAuthStore()

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isOffline, setIsOffline] = useState(false)
  const { isOnline, check: checkNetwork } = useNetworkStatus()

  // Editable fields — local state, saved on blur / toggle
  const [displayName, setDisplayName] = useState('')
  const [dailyGoal, setDailyGoal] = useState(20)
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)
  const [reminderHour, setReminderHour] = useState(20)
  const [restDay, setRestDay] = useState<number | null>(null)

  // Apple Watch
  const [watchEnabled, setWatchEnabledLocal] = useState(false)
  const [watchStatus, setWatchStatus] = useState<string>('Checking...')

  const loadWatchStatus = useCallback(async () => {
    const status = await getWatchConnectionStatus()
    console.log('[Watch] status:', JSON.stringify(status))
    if (!status.supported) { setWatchStatus('Not supported'); return }
    if (!status.paired) { setWatchStatus('Apple Watch not paired'); return }
    setWatchStatus(status.reachable ? 'Connected' : 'Paired — open Watch app to connect')
  }, [getWatchConnectionStatus])

  const handleWatchToggle = useCallback(async (value: boolean) => {
    setWatchEnabledLocal(value)
    const result = await setWatchEnabled(value)
    if (value) {
      loadWatchStatus()
      if (result) {
        Alert.alert(
          'Watch Sync',
          result.sent
            ? '✅ Context sent to Watch successfully'
            : `❌ Not sent — ${result.reason ?? 'unknown reason'}`,
        )
      }
    }
  }, [setWatchEnabled, loadWatchStatus])

  const handleForceSyncToWatch = useCallback(async () => {
    const status = await getWatchConnectionStatus()
    const result = await forceSyncToWatch()
    Alert.alert(
      'Watch Sync Diagnostic',
      `Status: paired=${status.paired}, reachable=${status.reachable}\n\n` +
      `Push result: ${result ? JSON.stringify(result) : 'native module unavailable'}`,
    )
    loadWatchStatus()
  }, [forceSyncToWatch, getWatchConnectionStatus, loadWatchStatus])

  // Social
  const { friends, pendingRequests, isSearching, loadAll, searchByEmail, sendRequest, respondToRequest, removeFriend } = useSocial()
  const [friendSearch, setFriendSearch] = useState('')
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)

  // ─── Learning profile ─────────────────────────────────────────────────────────
  const { learnerProfile, update: updateLearnerProfile } = useLearnerProfile()

  const [lpCountry, setLpCountry] = useState<string | null>(null)
  const [lpReasons, setLpReasons] = useState<string[]>([])
  const [lpInterests, setLpInterests] = useState<string[]>([])
  const [lpDirty, setLpDirty] = useState(false)
  const [lpSaving, setLpSaving] = useState(false)
  const [lpError, setLpError] = useState<string | null>(null)
  const [countryPickerVisible, setCountryPickerVisible] = useState(false)
  const [lpCountrySearch, setLpCountrySearch] = useState('')

  const INTEREST_OPTIONS = [
    'Manga', 'Anime', 'Gaming', 'Literature', 'Film',
    'Travel', 'Business', 'History', 'Technology', 'Other',
  ]

  // ── Load profile ─────────────────────────────────────────────────────────

  const applyProfile = useCallback((data: UserProfile) => {
    setProfile(data)
    setDisplayName(data.displayName ?? '')
    setDailyGoal(data.dailyGoal)
    setNotificationsEnabled(data.notificationsEnabled)
    setReminderHour(data.reminderHour ?? 20)
    setRestDay(data.restDay ?? null)
  }, [])

  const loadProfile = useCallback(async () => {
    setIsLoading(true)
    setIsOffline(false)

    // Show cache immediately
    const cached = await storage.getItem<{ data: UserProfile }>(PROFILE_CACHE_KEY)
    if (cached?.data) applyProfile(cached.data)

    // Re-probe network status so pull-to-refresh clears a stale offline banner
    checkNetwork()

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
  }, [user, applyProfile, checkNetwork])

  useEffect(() => {
    loadProfile()
    storage.getItem<boolean>('kl:watch_enabled').then((v) => {
      setWatchEnabledLocal(v ?? false)
      if (v) loadWatchStatus()
    })
  }, [loadProfile, loadWatchStatus])

  useEffect(() => {
    if (!learnerProfile) return
    setLpCountry(learnerProfile.country)
    setLpReasons(learnerProfile.reasonsForLearning)
    setLpInterests(learnerProfile.interests)
  }, [learnerProfile])

  // ── Save helpers ─────────────────────────────────────────────────────────

  const save = useCallback(async (patch: Partial<{
    displayName: string
    dailyGoal: number
    notificationsEnabled: boolean
    reminderHour: number
    restDay: number | null
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

  const handleRestDay = useCallback((day: number | null) => {
    setRestDay(day)
    save({ restDay: day })
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

  const toggleLpReason = useCallback((chip: string) => {
    setLpReasons((prev) => {
      const next = prev.includes(chip) ? prev.filter((r) => r !== chip) : [...prev, chip]
      setLpDirty(true)
      return next
    })
  }, [])

  const toggleLpInterest = useCallback((chip: string) => {
    setLpInterests((prev) => {
      const next = prev.includes(chip) ? prev.filter((r) => r !== chip) : [...prev, chip]
      setLpDirty(true)
      return next
    })
  }, [])

  const handleLpSave = useCallback(async () => {
    setLpSaving(true)
    setLpError(null)
    const ok = await updateLearnerProfile({
      country: lpCountry,
      reasonsForLearning: lpReasons,
      interests: lpInterests,
    })
    if (ok) {
      setLpDirty(false)
    } else {
      setLpError('Failed to save. Please try again.')
    }
    setLpSaving(false)
  }, [lpCountry, lpReasons, lpInterests, updateLearnerProfile])

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
            <>
              <View style={styles.reminderTimeRow}>
                <Ionicons name="time-outline" size={18} color={colors.textMuted} />
                <Text style={styles.reminderTimeLabel}>Remind me at</Text>
                <View style={styles.reminderHourPills}>
                  {[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22].map((h) => {
                    const isPm = h >= 12
                    const display = h === 12 ? '12pm' : h === 0 ? '12am' : isPm ? `${h - 12}pm` : `${h}am`
                    const active = reminderHour === h
                    return (
                      <TouchableOpacity
                        key={h}
                        style={[styles.reminderPill, active && styles.reminderPillActive]}
                        onPress={() => handleReminderHour(h)}
                      >
                        <Text style={[styles.reminderPillText, active && styles.reminderPillTextActive]}>{display}</Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </View>
              <View style={styles.reminderTimeRow}>
                <Ionicons name="cafe-outline" size={18} color={colors.textMuted} />
                <Text style={styles.reminderTimeLabel}>Rest day</Text>
                <View style={styles.reminderHourPills}>
                  {([null, 0, 1, 2, 3, 4, 5, 6] as (number | null)[]).map((d) => {
                    const label = d == null ? 'None' : ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]
                    const active = restDay === d
                    return (
                      <TouchableOpacity
                        key={d == null ? 'none' : d}
                        style={[styles.reminderPill, active && styles.reminderPillActive]}
                        onPress={() => handleRestDay(d)}
                      >
                        <Text style={[styles.reminderPillText, active && styles.reminderPillTextActive]}>{label}</Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </View>
            </>
          )}
        </Section>

        {/* Apple Watch */}
        <Section title="Apple Watch">
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Ionicons name="watch-outline" size={20} color={colors.textSecondary} />
              <View>
                <Text style={styles.rowLabel}>Enable Apple Watch</Text>
                <Text style={styles.rowSub}>Sync study sessions to your Watch</Text>
              </View>
            </View>
            <Switch
              value={watchEnabled}
              onValueChange={handleWatchToggle}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
          {watchEnabled && (
            <View style={styles.watchStatusRow}>
              <Ionicons
                name={watchStatus === 'Connected' ? 'checkmark-circle' : 'ellipse-outline'}
                size={14}
                color={watchStatus === 'Connected' ? colors.success : colors.textMuted}
              />
              <Text style={styles.watchStatusText}>{watchStatus}</Text>
              <TouchableOpacity onPress={handleForceSyncToWatch} style={styles.watchSyncBtn}>
                <Text style={styles.watchSyncBtnText}>Sync Now</Text>
              </TouchableOpacity>
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

        {/* Learning Profile */}
        <Section title="Learning Profile">
          {/* Country */}
          <TouchableOpacity
            style={styles.row}
            onPress={() => setCountryPickerVisible(true)}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <Ionicons name="globe-outline" size={20} color={colors.textSecondary} />
              <View>
                <Text style={styles.rowLabel}>Country</Text>
                <Text style={styles.rowSub}>
                  {lpCountry
                    ? (COUNTRIES.find((c) => c.code === lpCountry)?.name ?? lpCountry)
                    : 'Not set'}
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>

          {/* Focus / reasons for learning */}
          <View style={[styles.row, { flexDirection: 'column', alignItems: 'flex-start', gap: 10 }]}>
            <Text style={styles.rowLabel}>What I'm focused on right now</Text>
            <View style={lpStyles.chipsWrap}>
              {ONBOARDING_CONTENT.focus.chips.map((chip) => {
                const selected = lpReasons.includes(chip)
                return (
                  <TouchableOpacity
                    key={chip}
                    style={[lpStyles.chip, selected && lpStyles.chipSelected]}
                    onPress={() => toggleLpReason(chip)}
                    activeOpacity={0.7}
                  >
                    <Text style={[lpStyles.chipText, selected && lpStyles.chipTextSelected]}>
                      {chip}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>

          {/* Interests */}
          <View style={[styles.row, { flexDirection: 'column', alignItems: 'flex-start', gap: 10 }]}>
            <Text style={styles.rowLabel}>My interests</Text>
            <View style={lpStyles.chipsWrap}>
              {INTEREST_OPTIONS.map((chip) => {
                const selected = lpInterests.includes(chip)
                return (
                  <TouchableOpacity
                    key={chip}
                    style={[lpStyles.chip, selected && lpStyles.chipSelected]}
                    onPress={() => toggleLpInterest(chip)}
                    activeOpacity={0.7}
                  >
                    <Text style={[lpStyles.chipText, selected && lpStyles.chipTextSelected]}>
                      {chip}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>

          {/* Save button (dirty only) */}
          {lpDirty && (
            <View style={lpStyles.saveRow}>
              {lpError && <Text style={lpStyles.errorText}>{lpError}</Text>}
              <TouchableOpacity
                style={[lpStyles.saveBtn, lpSaving && lpStyles.saveBtnDisabled]}
                onPress={handleLpSave}
                disabled={lpSaving}
                activeOpacity={0.8}
              >
                {lpSaving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={lpStyles.saveBtnText}>Save</Text>}
              </TouchableOpacity>
            </View>
          )}
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
                  <Text style={styles.rowLabel}>{searchResult.user.displayName ?? friendSearch}</Text>
                  <Text style={styles.rowSub}>{friendSearch}</Text>
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
                      <Text style={styles.rowLabel}>{r.requesterName ?? 'Someone'}</Text>
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
                      <Text style={styles.rowLabel}>{f.displayName ?? 'Unknown'}</Text>
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

      {/* Country picker modal for Learning Profile */}
      <Modal
        visible={countryPickerVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { setCountryPickerVisible(false); setLpCountrySearch('') }}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
          <View style={[styles.row, { borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: spacing.md }]}>
            <Text style={[styles.rowLabel, { flex: 1, fontSize: 17 }]}>Select Country</Text>
            <TouchableOpacity onPress={() => { setCountryPickerVisible(false); setLpCountrySearch('') }}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <TextInput
            style={[styles.textInput, { margin: spacing.md, borderRadius: radius.md }]}
            placeholder="Search…"
            placeholderTextColor={colors.textMuted}
            value={lpCountrySearch}
            onChangeText={setLpCountrySearch}
            autoFocus
          />
          <FlatList
            data={
              lpCountrySearch.trim()
                ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(lpCountrySearch.toLowerCase()))
                : COUNTRIES
            }
            keyExtractor={(item) => item.code}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.row, { paddingHorizontal: spacing.md }]}
                onPress={() => {
                  setLpCountry(item.code)
                  setLpDirty(true)
                  setCountryPickerVisible(false)
                  setLpCountrySearch('')
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.rowLabel}>{item.name}</Text>
                {lpCountry === item.code && (
                  <Ionicons name="checkmark" size={18} color={colors.primary} />
                )}
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={() => (
              <View style={{ height: 1, backgroundColor: colors.border, marginHorizontal: spacing.lg }} />
            )}
            keyboardShouldPersistTaps="handled"
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

// ─── Learning Profile styles ──────────────────────────────────────────────────

const lpStyles = StyleSheet.create({
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  chipTextSelected: {
    color: '#0F0F1A',
  },
  saveRow: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    fontWeight: '700',
    color: '#0F0F1A',
    fontSize: 15,
  },
  errorText: {
    fontSize: 13,
    color: colors.error,
    marginBottom: 6,
    textAlign: 'center',
  },
})

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

  // Apple Watch status
  watchStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  watchStatusText: { ...typography.caption, color: colors.textMuted, flex: 1 },
  watchSyncBtn: { paddingHorizontal: 8, paddingVertical: 2, backgroundColor: colors.bgSurface, borderRadius: 4, borderWidth: 1, borderColor: colors.border },
  watchSyncBtnText: { ...typography.caption, color: colors.primary },

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
