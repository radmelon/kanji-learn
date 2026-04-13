import React, { useState, useRef, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  FlatList,
  Modal,
  Animated,
  Dimensions,
  SafeAreaView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { router } from 'expo-router'
import { useProfile } from '../src/hooks/useProfile'
import { useLearnerProfile } from '../src/hooks/useLearnerProfile'
import {
  ONBOARDING_CONTENT,
  COUNTRIES,
} from '../src/config/onboarding-content'
import { colors, spacing, radius, typography } from '../src/theme'

const SCREEN_WIDTH = Dimensions.get('window').width
const TOTAL_STEPS = 5
const ANIM_DURATION = 220

export default function OnboardingScreen() {
  const { update: updateProfile } = useProfile()
  const { update: updateLearnerProfile } = useLearnerProfile()

  // ── Step state ────────────────────────────────────────────────────────────
  const [currentStep, setCurrentStep] = useState(0)
  const translateX = useRef(new Animated.Value(0)).current

  // ── Step 2 — About You ────────────────────────────────────────────────────
  const [displayName, setDisplayName] = useState('')
  const [country, setCountry] = useState<string | null>(null)
  const [countryPickerVisible, setCountryPickerVisible] = useState(false)
  const [countrySearch, setCountrySearch] = useState('')

  // ── Step 3 — Focus ────────────────────────────────────────────────────────
  const [selectedReasons, setSelectedReasons] = useState<string[]>([])

  // ── Step 4 — Daily Target ─────────────────────────────────────────────────
  const [dailyGoal, setDailyGoal] = useState<number>(
    ONBOARDING_CONTENT.dailyTarget.defaultOption
  )
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // ── Navigation ────────────────────────────────────────────────────────────
  const goToStep = useCallback(
    (nextStep: number) => {
      const direction = nextStep > currentStep ? 1 : -1

      // Slide current content out
      Animated.timing(translateX, {
        toValue: -direction * SCREEN_WIDTH,
        duration: ANIM_DURATION,
        useNativeDriver: true,
      }).start(() => {
        // Snap to opposite side, update step
        translateX.setValue(direction * SCREEN_WIDTH)
        setCurrentStep(nextStep)

        // Slide new content in
        Animated.timing(translateX, {
          toValue: 0,
          duration: ANIM_DURATION,
          useNativeDriver: true,
        }).start()
      })
    },
    [currentStep, translateX]
  )

  // ── Country helpers ───────────────────────────────────────────────────────
  const selectedCountryName =
    country != null
      ? (COUNTRIES.find((c) => c.code === country)?.name ?? null)
      : null

  const filteredCountries = countrySearch.trim()
    ? COUNTRIES.filter((c) =>
        c.name.toLowerCase().includes(countrySearch.toLowerCase())
      )
    : COUNTRIES

  // ── Focus chip toggle ─────────────────────────────────────────────────────
  const toggleReason = (chip: string) => {
    setSelectedReasons((prev) =>
      prev.includes(chip) ? prev.filter((r) => r !== chip) : [...prev, chip]
    )
  }

  // ── Completion ────────────────────────────────────────────────────────────
  const handleComplete = async () => {
    setSaveError(null)
    setIsSaving(true)

    const [profileOk, learnerOk] = await Promise.all([
      updateProfile({
        displayName: displayName.trim() || null,
        dailyGoal,
        onboardingCompletedAt: new Date().toISOString(),
      }),
      updateLearnerProfile({
        country,
        reasonsForLearning: selectedReasons,
        interests: [],
      }),
    ])

    if (!profileOk || !learnerOk) {
      setSaveError('Something went wrong. Please try again.')
      setIsSaving(false)
      return
    }

    router.replace('/placement')
  }

  // ── Progress dots ─────────────────────────────────────────────────────────
  const ProgressDots = () => (
    <View style={styles.dotsRow}>
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            i === currentStep ? styles.dotActive : styles.dotInactive,
          ]}
        />
      ))}
    </View>
  )

  // ── Step renderers ────────────────────────────────────────────────────────

  const renderWelcome = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.kanjiHero}>{ONBOARDING_CONTENT.welcome.kanjiHero}</Text>
      <Text style={styles.headline}>{ONBOARDING_CONTENT.welcome.headline}</Text>
      <Text style={styles.body}>{ONBOARDING_CONTENT.welcome.body}</Text>
      <Text style={styles.tagline}>{ONBOARDING_CONTENT.welcome.tagline}</Text>
      <TouchableOpacity
        style={styles.ctaButton}
        onPress={() => goToStep(1)}
        activeOpacity={0.8}
      >
        <Text style={styles.ctaText}>{ONBOARDING_CONTENT.welcome.cta}</Text>
      </TouchableOpacity>
    </View>
  )

  const renderFindHelp = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.headline}>{ONBOARDING_CONTENT.findHelp.headline}</Text>
      <ScrollView
        style={styles.infoList}
        contentContainerStyle={styles.infoListContent}
        showsVerticalScrollIndicator={false}
      >
        {ONBOARDING_CONTENT.findHelp.items.map((item, index) => (
          <View key={index} style={styles.infoCard}>
            <Text style={styles.infoCardLocation}>{item.location}</Text>
            <Text style={styles.infoCardDescription}>{item.description}</Text>
          </View>
        ))}
        <Text style={styles.footerNote}>{ONBOARDING_CONTENT.findHelp.footer}</Text>
      </ScrollView>
      <TouchableOpacity
        style={styles.ctaButton}
        onPress={() => goToStep(2)}
        activeOpacity={0.8}
      >
        <Text style={styles.ctaText}>{ONBOARDING_CONTENT.findHelp.cta}</Text>
      </TouchableOpacity>
    </View>
  )

  const renderAboutYou = () => (
    <KeyboardAvoidingView
      style={styles.stepContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.headline}>{ONBOARDING_CONTENT.aboutYou.headline}</Text>
      <TextInput
        style={styles.textInput}
        value={displayName}
        onChangeText={setDisplayName}
        placeholder={ONBOARDING_CONTENT.aboutYou.namePlaceholder}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="words"
        returnKeyType="done"
      />
      <TouchableOpacity
        style={styles.countryRow}
        onPress={() => setCountryPickerVisible(true)}
        activeOpacity={0.7}
      >
        <Text
          style={
            selectedCountryName ? styles.countrySelected : styles.countryPlaceholder
          }
        >
          {selectedCountryName ?? ONBOARDING_CONTENT.aboutYou.countryPlaceholder}
        </Text>
        <Text style={styles.countryChevron}>›</Text>
      </TouchableOpacity>
      <View style={styles.spacer} />
      <TouchableOpacity
        style={styles.ctaButton}
        onPress={() => goToStep(3)}
        activeOpacity={0.8}
      >
        <Text style={styles.ctaText}>{ONBOARDING_CONTENT.aboutYou.cta}</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  )

  const renderFocus = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.headline}>{ONBOARDING_CONTENT.focus.headline}</Text>
      <Text style={styles.subhead}>{ONBOARDING_CONTENT.focus.subhead}</Text>
      <View style={styles.chipsWrap}>
        {ONBOARDING_CONTENT.focus.chips.map((chip) => {
          const selected = selectedReasons.includes(chip)
          return (
            <TouchableOpacity
              key={chip}
              style={[styles.chip, selected ? styles.chipSelected : styles.chipUnselected]}
              onPress={() => toggleReason(chip)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.chipText,
                  selected ? styles.chipTextSelected : styles.chipTextUnselected,
                ]}
              >
                {chip}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>
      <View style={styles.spacer} />
      <TouchableOpacity
        style={styles.ctaButton}
        onPress={() => goToStep(4)}
        activeOpacity={0.8}
      >
        <Text style={styles.ctaText}>{ONBOARDING_CONTENT.focus.cta}</Text>
      </TouchableOpacity>
    </View>
  )

  const renderDailyTarget = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.headline}>{ONBOARDING_CONTENT.dailyTarget.headline}</Text>
      <View style={styles.chipsWrap}>
        {ONBOARDING_CONTENT.dailyTarget.options.map((option) => {
          const selected = dailyGoal === option
          return (
            <TouchableOpacity
              key={option}
              style={[styles.chip, selected ? styles.chipSelected : styles.chipUnselected]}
              onPress={() => setDailyGoal(option)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.chipText,
                  selected ? styles.chipTextSelected : styles.chipTextUnselected,
                ]}
              >
                {option}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>
      {saveError != null && (
        <Text style={styles.errorText}>{saveError}</Text>
      )}
      <View style={styles.spacer} />
      <TouchableOpacity
        style={[styles.ctaButton, isSaving && styles.ctaButtonDisabled]}
        onPress={handleComplete}
        disabled={isSaving}
        activeOpacity={0.8}
      >
        {isSaving ? (
          <ActivityIndicator color={colors.textPrimary} />
        ) : (
          <Text style={styles.ctaText}>{ONBOARDING_CONTENT.dailyTarget.cta}</Text>
        )}
      </TouchableOpacity>
    </View>
  )

  const steps = [renderWelcome, renderFindHelp, renderAboutYou, renderFocus, renderDailyTarget]

  // ── Country Picker Modal ──────────────────────────────────────────────────
  const CountryPickerModal = () => (
    <Modal
      visible={countryPickerVisible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setCountryPickerVisible(false)}
    >
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Select Country</Text>
          <TouchableOpacity
            style={styles.modalCloseButton}
            onPress={() => {
              setCountryPickerVisible(false)
              setCountrySearch('')
            }}
          >
            <Text style={styles.modalCloseText}>✕</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.modalSearchInput}
          value={countrySearch}
          onChangeText={setCountrySearch}
          placeholder="Search countries…"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        <FlatList
          data={filteredCountries}
          keyExtractor={(item) => item.code}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.countryItem,
                item.code === country && styles.countryItemSelected,
              ]}
              onPress={() => {
                setCountry(item.code)
                setCountryPickerVisible(false)
                setCountrySearch('')
              }}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.countryItemText,
                  item.code === country && styles.countryItemTextSelected,
                ]}
              >
                {item.name}
              </Text>
              {item.code === country && (
                <Text style={styles.countryItemCheck}>✓</Text>
              )}
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={styles.divider} />}
          keyboardShouldPersistTaps="handled"
        />
      </SafeAreaView>
    </Modal>
  )

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root}>
      <ProgressDots />

      {/* Back button — visible on steps 2–4 */}
      {currentStep >= 2 && (
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => goToStep(currentStep - 1)}
          activeOpacity={0.7}
        >
          <Text style={styles.backButtonText}>‹</Text>
        </TouchableOpacity>
      )}

      <Animated.View
        style={[styles.animatedWrapper, { transform: [{ translateX }] }]}
      >
        {steps[currentStep]()}
      </Animated.View>

      <CountryPickerModal />
    </SafeAreaView>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  // Progress dots
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  dot: {
    height: 6,
    borderRadius: radius.full,
  },
  dotActive: {
    width: 20,
    backgroundColor: colors.primary,
  },
  dotInactive: {
    width: 6,
    backgroundColor: colors.textMuted,
  },

  // Back button
  backButton: {
    position: 'absolute',
    top: spacing.lg + spacing.xl,
    left: spacing.md,
    zIndex: 10,
    padding: spacing.sm,
  },
  backButtonText: {
    ...typography.h1,
    color: colors.textSecondary,
    lineHeight: 28,
  },

  // Animated wrapper
  animatedWrapper: {
    flex: 1,
  },

  // Step container
  stepContainer: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    paddingTop: spacing.xl,
  },

  spacer: {
    flex: 1,
  },

  // Welcome step
  kanjiHero: {
    ...typography.kanjiDisplay,
    color: colors.primary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  headline: {
    ...typography.h1,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: spacing.md,
  },
  tagline: {
    ...typography.bodySmall,
    color: colors.textMuted,
    textAlign: 'center',
    fontStyle: 'italic',
    marginBottom: spacing.xxl,
  },

  // CTA button
  ctaButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  ctaButtonDisabled: {
    opacity: 0.6,
  },
  ctaText: {
    ...typography.h3,
    color: colors.textPrimary,
  },

  // Find help step
  infoList: {
    flex: 1,
    marginBottom: spacing.md,
  },
  infoListContent: {
    paddingBottom: spacing.md,
  },
  infoCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  infoCardLocation: {
    ...typography.h3,
    color: colors.accent,
    marginBottom: spacing.xs,
  },
  infoCardDescription: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  footerNote: {
    ...typography.bodySmall,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },

  // About you step
  textInput: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    ...typography.body,
    marginBottom: spacing.md,
  },
  countryRow: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  countrySelected: {
    ...typography.body,
    color: colors.textPrimary,
  },
  countryPlaceholder: {
    ...typography.body,
    color: colors.textMuted,
  },
  countryChevron: {
    ...typography.h2,
    color: colors.textMuted,
    lineHeight: 22,
  },

  // Focus & Daily Target chips
  subhead: {
    ...typography.bodySmall,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  chip: {
    borderRadius: radius.full,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipUnselected: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
  },
  chipText: {
    ...typography.bodySmall,
  },
  chipTextSelected: {
    color: colors.textPrimary,
  },
  chipTextUnselected: {
    color: colors.textSecondary,
  },

  // Error text
  errorText: {
    ...typography.bodySmall,
    color: colors.error,
    textAlign: 'center',
    marginTop: spacing.md,
  },

  // Country picker modal
  modalContainer: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  modalTitle: {
    ...typography.h2,
    color: colors.textPrimary,
  },
  modalCloseButton: {
    padding: spacing.sm,
  },
  modalCloseText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  modalSearchInput: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    ...typography.body,
    margin: spacing.md,
  },
  countryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  countryItemSelected: {
    backgroundColor: colors.bgSurface,
  },
  countryItemText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  countryItemTextSelected: {
    color: colors.textPrimary,
  },
  countryItemCheck: {
    ...typography.body,
    color: colors.primary,
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
  },
})
