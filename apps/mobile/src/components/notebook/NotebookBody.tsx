import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { CommitmentView, NotebookEntry, NotebookSection, NotebookView } from '@kanji-learn/shared'
import { colors, radius, spacing, typography } from '../../theme'
import { TutorNote } from './TutorNote'

const noop = () => {}

// Every Text in this file carries an explicit colour.
//
// B146, found on device: a screen shipped with no styling at all. React Native
// defaults <Text> to black and colors.bg is #0F0F1A, so the screen rendered
// correctly and was entirely invisible. The seven component tests passed
// throughout, because getByText finds text whatever colour it is. Colour is
// asserted explicitly in NotebookBody.test.tsx — do not defeat it.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function cadenceLine(cadence: NotebookView['cadence']): string {
  if (cadence.buddyDay === null) return 'Buddy checks in when you ask.'
  const day = DAYS[cadence.buddyDay]
  const freq = cadence.intervalWeeks === 1 ? 'weekly' : `every ${cadence.intervalWeeks} weeks`
  return `Buddy checks in ${freq}, on ${day}s`
}

export function NotebookBody({
  view,
  onAdd,
  onEdit,
  onDelete,
  onLookupKanji,
  onSpeak,
  onTranslate,
  onChangeCadence,
}: {
  view: NotebookView
  onAdd: (sectionKey: NotebookSection['key']) => void
  onEdit: (entry: NotebookEntry) => void
  onDelete: (entry: NotebookEntry) => void
  /** All are I/O and belong to the screen, not this pure component (see
   *  NotebookBody/TutorNote header comments). `onTranslate` is left unwired
   *  here on purpose — there is no translation endpoint yet — and
   *  `onChangeCadence` likewise: both controls render only when a caller
   *  actually supplies a handler, never as a control that does nothing. */
  onLookupKanji?: (char: string) => void
  onSpeak?: (text: string) => void
  onTranslate?: (noteId: string) => void
  onChangeCadence?: () => void
}) {
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.cadenceText}>{cadenceLine(view.cadence)}</Text>
        {onChangeCadence && (
          <Pressable
            testID="notebook-cadence-control"
            accessibilityRole="button"
            accessibilityLabel="Change check-in schedule"
            hitSlop={12}
            onPress={onChangeCadence}
          >
            <Text style={styles.cadenceControl}>Change</Text>
          </Pressable>
        )}
      </View>

      {view.agreement ? (
        <AgreementCard agreement={view.agreement} />
      ) : (
        <View testID="notebook-agreement-pending" style={styles.pendingCard}>
          <Text style={styles.pendingLabel}>THIS WEEK</Text>
          <Text style={styles.pendingBody}>
            Once you've done the placement test, Buddy will set the first week here.
          </Text>
        </View>
      )}

      {view.experiment && <AgreementCard agreement={view.experiment} label="TRYING THIS WEEK" />}

      {view.sections.map((section) => (
        <NotebookSectionView key={section.key} section={section} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} />
      ))}

      {view.tutorNotes.map((tutorShare) => (
        <View key={tutorShare.shareId} testID="notebook-section-tutor" style={styles.section}>
          <Text style={styles.sectionTitle}>{tutorShare.tutorLabel}</Text>
          {tutorShare.notes.map((note) => (
            <TutorNote
              key={note.id}
              note={note}
              onLookupKanji={onLookupKanji ?? noop}
              onSpeak={onSpeak ?? noop}
              onTranslate={onTranslate}
            />
          ))}
        </View>
      ))}

      {view.isEmpty && (
        <View testID="notebook-empty" style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Nothing here yet</Text>
          <Text style={styles.emptyBody}>
            As you and Buddy work together, what you notice and settle on will show up here.
          </Text>
        </View>
      )}
    </View>
  )
}

function AgreementCard({ agreement, label = 'THIS WEEK' }: { agreement: CommitmentView; label?: string }) {
  return (
    <View testID="notebook-agreement" style={styles.card}>
      <Text style={styles.pendingLabel}>{label}</Text>
      <Text style={styles.agreementBody}>
        {agreement.daysCommitted} days, {agreement.minutesPerDay} minutes
      </Text>
      {agreement.focus && <Text style={styles.entryMeta}>{agreement.focus}</Text>}
    </View>
  )
}

function NotebookSectionView({
  section,
  onAdd,
  onEdit,
  onDelete,
}: {
  section: NotebookSection
  onAdd: (sectionKey: NotebookSection['key']) => void
  onEdit: (entry: NotebookEntry) => void
  onDelete: (entry: NotebookEntry) => void
}) {
  return (
    <View testID={`notebook-section-${section.key}`} style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{section.title}</Text>
        <Pressable
          testID={`notebook-add-${section.key}`}
          accessibilityRole="button"
          accessibilityLabel={`Add to ${section.title}`}
          hitSlop={12}
          onPress={() => onAdd(section.key)}
        >
          <Text style={styles.addControl}>+ Add</Text>
        </Pressable>
      </View>
      {section.live.map((entry) => (
        <Pressable
          key={entry.id}
          style={styles.entry}
          accessibilityRole="button"
          accessibilityLabel="Edit entry"
          onPress={() => onEdit(entry)}
        >
          <Text style={styles.entryBody}>{entry.body}</Text>
          {entry.author !== 'tutor' && (
            <Pressable
              testID={`notebook-delete-${entry.id}`}
              accessibilityRole="button"
              accessibilityLabel="Delete"
              hitSlop={12}
              onPress={() => onDelete(entry)}
            >
              <Text style={styles.deleteControl}>Remove</Text>
            </Pressable>
          )}
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: spacing.md, gap: spacing.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cadenceText: { ...typography.body, color: colors.textSecondary, flexShrink: 1 },
  cadenceControl: { ...typography.bodySmall, color: colors.primary, fontWeight: '600' },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  pendingCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  pendingLabel: { ...typography.caption, color: colors.textMuted, textTransform: 'uppercase' },
  pendingBody: { ...typography.body, color: colors.textSecondary },
  agreementBody: { ...typography.h3, color: colors.textPrimary },
  section: { gap: spacing.sm },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: { ...typography.h3, color: colors.textPrimary },
  addControl: { ...typography.bodySmall, color: colors.primary, fontWeight: '600' },
  entry: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  entryBody: { ...typography.body, color: colors.textPrimary, flexShrink: 1 },
  entryMeta: { ...typography.caption, color: colors.textMuted },
  deleteControl: { ...typography.caption, color: colors.textMuted },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.xs,
  },
  emptyTitle: { ...typography.h3, color: colors.textPrimary },
  emptyBody: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
})
