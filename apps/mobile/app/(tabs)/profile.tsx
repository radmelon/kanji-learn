import { useState, useCallback, useEffect } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Switch, ActivityIndicator, Alert, RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useAuthStore } from '../../src/stores/auth.store'
import { api } from '../../src/lib/api'
import { colors, spacing, radius, typography } from '../../src/theme'

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserProfile {
  id: string
  displayName: string | null
  dailyGoal: number
  notificationsEnabled: boolean
  timezone: string
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

  // Editable fields — local state, saved on blur / toggle
  const [displayName, setDisplayName] = useState('')
  const [dailyGoal, setDailyGoal] = useState(20)
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)

  // ── Load profile ─────────────────────────────────────────────────────────

  const loadProfile = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await api.get<UserProfile>('/v1/user/profile')
      setProfile(data)
      setDisplayName(data.displayName ?? '')
      setDailyGoal(data.dailyGoal)
      setNotificationsEnabled(data.notificationsEnabled)
    } catch {
      // Profile may not exist yet for brand-new users — use auth metadata
      const name = user?.user_metadata?.display_name ?? ''
      setDisplayName(name)
    } finally {
      setIsLoading(false)
    }
  }, [user])

  useEffect(() => {
    loadProfile()
  }, [loadProfile])

  // ── Save helpers ─────────────────────────────────────────────────────────

  const save = useCallback(async (patch: Partial<{
    displayName: string
    dailyGoal: number
    notificationsEnabled: boolean
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
        </Section>

        {/* App links */}
        <Section title="App">
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
