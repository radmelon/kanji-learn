/**
 * voiceReveal.logic.ts
 *
 * Pure functions for the Speaking drill's progressive-hint ladder.
 * No React, no state, no side effects — unit-testable in isolation.
 *
 * Terminology:
 *   - `attempts` (local state) = zero-indexed count of WRONG results received.
 *     attempts=0 → try 1 layout (nothing revealed).
 *     attempts=1 → try 2 layout (kun/on + kanji meaning).
 *     attempts=2 → try 3 layout (+ hiragana).
 *     attempts=3 → try 4+ layout (+ forced pitch + vocab meaning + bail).
 *   - `attemptsCount` (wire format, 1-indexed) = which try this POST represents.
 *     Computed as attempts + 1 at the network boundary.
 */

export interface RevealFlags {
  showKunOn:         boolean
  showKanjiMeaning:  boolean
  showHiragana:      boolean
  forcePitch:        boolean
  showVocabMeaning:  boolean
  canBail:           boolean
}

export function computeReveals(attempts: number): RevealFlags {
  return {
    showKunOn:        attempts >= 1,
    showKanjiMeaning: attempts >= 1,
    showHiragana:     attempts >= 2,
    forcePitch:       attempts >= 3,
    showVocabMeaning: attempts >= 3,
    canBail:          attempts >= 3,
  }
}

export function computeAttemptsCount(attempts: number): number {
  return attempts + 1
}

export function targetChipMask(word: string, targetKanji: string): boolean[] {
  if (!targetKanji) return Array.from(word).map(() => false)
  return Array.from(word).map((c) => c === targetKanji)
}
