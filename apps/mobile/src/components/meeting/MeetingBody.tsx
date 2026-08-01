import React, { useState } from 'react'
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native'
import { DAY_NAMES, type Beat, type ExtractedPatch } from '@kanji-learn/shared'
import type { MeetingUiState } from '../../lib/meeting-state'
import { ONBOARDING_CONTENT } from '../../config/onboarding-content'
import { colors, radius, spacing, typography } from '../../theme'

// Pure props-in component — the screen (app/onboarding.tsx) owns all I/O and
// wires this to the store. No api/supabase/store import belongs here: the
// jest-expo component lane crashes if this file transitively drags one in
// (Phase 6 lesson).
//
// Every <Text> in this file carries an explicit colour — B146, found on
// device: a sibling component (BuddySessionBody) shipped with no styling at
// all. React Native defaults <Text> to black and colors.bg is near-black, so
// the screen rendered correctly and was entirely invisible. The component
// test enumerates every beat surface and asserts colour explicitly.

const SHORT_DAY_LABELS = DAY_NAMES.map((d) => d.slice(0, 3))
const DAILY_GOAL_OPTIONS = ONBOARDING_CONTENT.dailyTarget.options
const FOCUS_CHIPS = ONBOARDING_CONTENT.focus.chips

export function MeetingBody({
  ui,
  onAnswer,
  onSendText,
  onFinish,
  onSkipToForm,
  onSkipOutright,
}: {
  ui: MeetingUiState
  onAnswer: (patch: ExtractedPatch) => void
  onSendText: (text: string) => void
  onFinish: (dest: 'placement' | 'home') => void
  onSkipToForm: () => void
  onSkipOutright: () => void
}) {
  const [composerText, setComposerText] = useState('')

  const handleSkip = () => {
    // B146-adjacent lesson learned the hard way elsewhere in this repo: a
    // learner who has already onboarded before (re-entering the meeting
    // after a reset, or from a support flow) skipping here must not be
    // routed back through the first-run form.
    if (ui.collected.hadPriorData) onSkipOutright()
    else onSkipToForm()
  }

  const handleSend = () => {
    const trimmed = composerText.trim()
    if (!trimmed || ui.busy) return
    onSendText(trimmed)
    setComposerText('')
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Buddy</Text>
        <Pressable
          testID="meeting-skip"
          onPress={handleSkip}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Skip for now"
        >
          <Text style={styles.skipText}>Skip for now</Text>
        </Pressable>
      </View>

      <ScrollView
        testID="meeting-transcript"
        style={styles.transcript}
        contentContainerStyle={styles.transcriptContent}
      >
        {ui.transcript.map((item) => (
          <View
            key={item.id}
            style={item.who === 'learner' ? styles.bubbleRowLearner : styles.bubbleRowBuddy}
          >
            <View style={item.who === 'learner' ? styles.bubbleLearner : styles.bubbleBuddy}>
              <Text
                testID={`bubble-${item.id}`}
                style={item.who === 'learner' ? styles.bubbleTextLearner : styles.bubbleTextBuddy}
              >
                {item.text}
              </Text>
            </View>
          </View>
        ))}
        {ui.busy && (
          <View testID="meeting-busy" style={styles.busyRow}>
            <ActivityIndicator color={colors.textMuted} />
            <Text style={styles.busyText}>Buddy is typing…</Text>
          </View>
        )}
      </ScrollView>

      <AnswerSurface ui={ui} onAnswer={onAnswer} onFinish={onFinish} />

      {ui.tier === 'cloud' && (
        <View testID="meeting-composer" style={styles.composer}>
          <TextInput
            style={styles.composerInput}
            value={composerText}
            onChangeText={setComposerText}
            placeholder="Or just tell Buddy…"
            placeholderTextColor={colors.textMuted}
            editable={!ui.busy}
            onSubmitEditing={handleSend}
            returnKeyType="send"
          />
          <Pressable
            testID="meeting-composer-send"
            onPress={handleSend}
            disabled={ui.busy || !composerText.trim()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Send"
          >
            <Text style={styles.composerSendText}>Send</Text>
          </Pressable>
        </View>
      )}
    </View>
  )
}

// ─── Per-beat answer surface ────────────────────────────────────────────────
// Structure is ours to design; the contract is testID={'answer-' + beat.kind}
// on the outer element of each branch (brief Step 3), enumerated exhaustively
// so a deleted branch fails the it.each in the component test.

function AnswerSurface({
  ui,
  onAnswer,
  onFinish,
}: {
  ui: MeetingUiState
  onAnswer: (patch: ExtractedPatch) => void
  onFinish: (dest: 'placement' | 'home') => void
}) {
  const { beat, tier, busy } = ui

  switch (beat.kind) {
    case 'intro':
    case 'orientation':
      return (
        <View testID={`answer-${beat.kind}`} style={styles.answerSurface}>
          <PrimaryButton label="Got it" disabled={busy} onPress={() => onAnswer({})} />
        </View>
      )
    case 'why':
      return (
        <View testID="answer-why" style={styles.answerSurface}>
          <WhyAnswer tier={tier} busy={busy} onAnswer={onAnswer} />
        </View>
      )
    case 'frame_ask':
      return (
        <View testID="answer-frame_ask" style={styles.answerSurface}>
          <View style={styles.stackedButtons}>
            <PrimaryButton
              label="Something like the JLPT"
              disabled={busy}
              onPress={() => onAnswer({ explicitRuler: 'jlpt' })}
            />
            <SecondaryButton
              label="For myself"
              disabled={busy}
              onPress={() => onAnswer({ explicitRuler: 'grade' })}
            />
          </View>
        </View>
      )
    case 'meaning':
      return (
        <View testID="answer-meaning" style={styles.answerSurface}>
          <MeaningAnswer beat={beat} busy={busy} onAnswer={onAnswer} />
        </View>
      )
    case 'meet':
      return (
        <View testID="answer-meet" style={styles.answerSurface}>
          <MeetAnswer beat={beat} busy={busy} onAnswer={onAnswer} />
        </View>
      )
    case 'ask':
      return (
        <View testID="answer-ask" style={styles.answerSurface}>
          <View style={styles.stackedButtons}>
            <PrimaryButton label="Take it now" disabled={busy} onPress={() => onFinish('placement')} />
            <SecondaryButton
              label="Before our first meeting"
              disabled={busy}
              onPress={() => onFinish('home')}
            />
          </View>
        </View>
      )
    case 'done':
      // Transient: the ask beat's two closes both leave the screen before the
      // meeting reducer would ever advance here.
      return null
  }
}

function WhyAnswer({
  tier,
  busy,
  onAnswer,
}: {
  tier: MeetingUiState['tier']
  busy: boolean
  onAnswer: (patch: ExtractedPatch) => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [interestsText, setInterestsText] = useState('')

  const toggle = (chip: string) => {
    setSelected((prev) => (prev.includes(chip) ? prev.filter((c) => c !== chip) : [...prev, chip]))
  }

  const submit = () => {
    // Interests may be empty here — the completeness check (nextRequirement)
    // brings the why beat straight back if so. Template tier has no free-text
    // row at all, so it always submits interests: [].
    const interests = interestsText
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    onAnswer({ reasons: selected, interests })
  }

  return (
    <View style={styles.whyWrap}>
      <View style={styles.chipsWrap}>
        {FOCUS_CHIPS.map((chip) => {
          const isSelected = selected.includes(chip)
          return (
            <Pressable
              key={chip}
              onPress={() => toggle(chip)}
              disabled={busy}
              style={[styles.chip, isSelected ? styles.chipSelected : styles.chipUnselected]}
              accessibilityRole="button"
            >
              <Text style={isSelected ? styles.chipTextSelected : styles.chipTextUnselected}>
                {chip}
              </Text>
            </Pressable>
          )
        })}
      </View>
      {tier === 'cloud' && (
        <TextInput
          style={styles.interestsInput}
          value={interestsText}
          onChangeText={setInterestsText}
          placeholder="What are you into? (comma-separated)"
          placeholderTextColor={colors.textMuted}
          editable={!busy}
        />
      )}
      <PrimaryButton label="Done" disabled={busy} onPress={submit} />
    </View>
  )
}

function MeaningAnswer({
  beat,
  busy,
  onAnswer,
}: {
  beat: Extract<Beat, { kind: 'meaning' }>
  busy: boolean
  onAnswer: (patch: ExtractedPatch) => void
}) {
  const [selected, setSelected] = useState<number>(beat.proposedGoal)

  return (
    <View style={styles.meaningWrap}>
      <View style={styles.chipsWrap}>
        {DAILY_GOAL_OPTIONS.map((option) => {
          const isSelected = selected === option
          return (
            <Pressable
              key={option}
              onPress={() => setSelected(option)}
              disabled={busy}
              style={[styles.chip, isSelected ? styles.chipSelected : styles.chipUnselected]}
              accessibilityRole="button"
            >
              <Text style={isSelected ? styles.chipTextSelected : styles.chipTextUnselected}>
                {option}
              </Text>
            </Pressable>
          )
        })}
      </View>
      <PrimaryButton
        label="Sounds good"
        disabled={busy}
        onPress={() => onAnswer({ dailyGoal: selected })}
      />
    </View>
  )
}

const INTERVAL_OPTIONS = [
  { label: 'Weekly', weeks: 1 as const },
  { label: 'Fortnightly', weeks: 2 as const },
]

function MeetAnswer({
  beat,
  busy,
  onAnswer,
}: {
  beat: Extract<Beat, { kind: 'meet' }>
  busy: boolean
  onAnswer: (patch: ExtractedPatch) => void
}) {
  const [day, setDay] = useState<number>(beat.proposedDay)
  const [intervalWeeks, setIntervalWeeks] = useState<1 | 2>(1)

  return (
    <View style={styles.meetWrap}>
      <View style={styles.chipsWrap}>
        {SHORT_DAY_LABELS.map((label, index) => {
          const isSelected = day === index
          return (
            <Pressable
              key={label}
              onPress={() => setDay(index)}
              disabled={busy}
              style={[styles.chip, isSelected ? styles.chipSelected : styles.chipUnselected]}
              accessibilityRole="button"
            >
              <Text style={isSelected ? styles.chipTextSelected : styles.chipTextUnselected}>
                {label}
              </Text>
            </Pressable>
          )
        })}
      </View>
      <View style={styles.chipsWrap}>
        {INTERVAL_OPTIONS.map(({ label, weeks }) => {
          const isSelected = intervalWeeks === weeks
          return (
            <Pressable
              key={label}
              onPress={() => setIntervalWeeks(weeks)}
              disabled={busy}
              style={[styles.chip, isSelected ? styles.chipSelected : styles.chipUnselected]}
              accessibilityRole="button"
            >
              <Text style={isSelected ? styles.chipTextSelected : styles.chipTextUnselected}>
                {label}
              </Text>
            </Pressable>
          )
        })}
      </View>
      <PrimaryButton
        label="Sounds good"
        disabled={busy}
        onPress={() => onAnswer({ buddyDay: day, buddyIntervalWeeks: intervalWeeks })}
      />
    </View>
  )
}

// ─── Buttons ─────────────────────────────────────────────────────────────

function PrimaryButton({
  label,
  disabled,
  onPress,
}: {
  label: string
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.primaryButton, disabled && styles.buttonDisabled]}
      accessibilityRole="button"
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  )
}

function SecondaryButton({
  label,
  disabled,
  onPress,
}: {
  label: string
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.secondaryButton, disabled && styles.buttonDisabled]}
      accessibilityRole="button"
    >
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  headerTitle: { ...typography.h2, color: colors.textPrimary },
  skipText: { ...typography.bodySmall, color: colors.textMuted },

  transcript: { flex: 1 },
  transcriptContent: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },

  bubbleRowBuddy: { flexDirection: 'row', justifyContent: 'flex-start' },
  bubbleRowLearner: { flexDirection: 'row', justifyContent: 'flex-end' },
  bubbleBuddy: {
    maxWidth: '85%',
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleLearner: {
    maxWidth: '85%',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleTextBuddy: { ...typography.body, color: colors.textPrimary, lineHeight: 22 },
  bubbleTextLearner: { ...typography.body, color: '#FFFFFF', lineHeight: 22 },

  busyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  busyText: { ...typography.caption, color: colors.textMuted },

  answerSurface: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  stackedButtons: { gap: spacing.sm },

  whyWrap: { gap: spacing.sm },
  meaningWrap: { gap: spacing.sm },
  meetWrap: { gap: spacing.sm },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderRadius: radius.full,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipUnselected: { backgroundColor: 'transparent', borderColor: colors.border },
  chipTextSelected: { ...typography.bodySmall, color: colors.textPrimary },
  chipTextUnselected: { ...typography.bodySmall, color: colors.textSecondary },

  interestsInput: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    ...typography.bodySmall,
  },

  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  primaryButtonText: { ...typography.h3, color: colors.textPrimary },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  secondaryButtonText: { ...typography.body, color: colors.textSecondary },
  buttonDisabled: { opacity: 0.5 },

  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  composerInput: {
    flex: 1,
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    ...typography.body,
  },
  composerSendText: { ...typography.body, color: colors.primary, fontWeight: '600' },
})
