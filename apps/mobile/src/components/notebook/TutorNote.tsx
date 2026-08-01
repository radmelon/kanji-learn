import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { TutorNoteView } from '@kanji-learn/shared'
import { colors, radius, spacing, typography } from '../../theme'

// Every Text in this file carries an explicit colour — see NotebookBody.tsx
// for the B146 history this guards against. Colour is asserted explicitly
// in TutorNote.test.tsx; do not defeat it.

// CJK Unified Ideographs. Kana and punctuation deliberately fall outside
// this range and render as plain text — every character tappable would
// turn the note into a wall of buttons.
const KANJI_RE = /[一-鿿]/

/** A tutor's note as a study surface (Task 9 / spec decision #8): a tutor
 *  may write in Japanese deliberately, to make the learner read it. The body
 *  therefore always renders exactly as written — never auto-translated.
 *  Each kanji is individually tappable for lookup, the whole note can be
 *  read aloud, and translation exists only as an explicit, visibly-recorded
 *  escape hatch the learner chooses.
 *
 *  Kanji spans use <Text onPress> rather than a nested <Pressable> — React
 *  Native's text layout only supports Text/Image as descendants of <Text> on
 *  real devices, so embedding a View-based Pressable inline would break
 *  native rendering even though it renders fine under the test renderer. */
export function TutorNote({
  note,
  onLookupKanji,
  onSpeak,
  onTranslate,
}: {
  note: TutorNoteView
  onLookupKanji: (character: string) => void
  onSpeak: (body: string) => void
  /** No translation endpoint exists (Task 9 plan never specified one). The
   *  control below renders only when a caller actually supplies this — a
   *  control that does nothing is worse than a control that is not there. */
  onTranslate?: (noteId: string) => void
}) {
  const characters = Array.from(note.body)

  return (
    <View style={styles.root}>
      <Text style={styles.body}>
        {characters.map((char, index) =>
          KANJI_RE.test(char) ? (
            <Text
              key={index}
              testID={`tutor-note-kanji-${char}`}
              accessibilityRole="button"
              accessibilityLabel={`Look up ${char}`}
              style={styles.kanji}
              onPress={() => onLookupKanji(char)}
            >
              {char}
            </Text>
          ) : (
            <Text key={index} style={styles.body}>
              {char}
            </Text>
          ),
        )}
      </Text>

      <View style={styles.controls}>
        <Pressable
          testID="tutor-note-speak"
          accessibilityRole="button"
          accessibilityLabel="Read note aloud"
          hitSlop={12}
          onPress={() => onSpeak(note.body)}
        >
          <Text style={styles.control}>Read aloud</Text>
        </Pressable>
        {onTranslate && (
          <Pressable
            testID="tutor-note-translate"
            accessibilityRole="button"
            accessibilityLabel="Translate note"
            hitSlop={12}
            onPress={() => onTranslate(note.id)}
          >
            <Text style={styles.control}>Translate</Text>
          </Pressable>
        )}
      </View>

      {note.translation !== null && (
        <View testID="tutor-note-translation" style={styles.translationBox}>
          <Text testID="tutor-note-translated-marker" style={styles.translatedMarker}>
            You asked for a translation.
          </Text>
          <Text style={styles.translationText}>{note.translation}</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  body: { ...typography.body, color: colors.textPrimary },
  kanji: { ...typography.body, color: colors.primary, fontWeight: '600' },
  controls: { flexDirection: 'row', gap: spacing.md },
  control: { ...typography.bodySmall, color: colors.primary, fontWeight: '600' },
  translationBox: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  translatedMarker: { ...typography.caption, color: colors.textMuted },
  translationText: { ...typography.body, color: colors.textSecondary },
})
