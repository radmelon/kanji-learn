import type { AssemblerSlots, RadicalEntry } from './types'

/** Sum of UTF-16 code units — a tiny stable hash for deterministic frame choice. */
function charHash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i)) % 100000
  return h
}

function componentClause(components: RadicalEntry[]): string {
  if (components.length === 0) return 'Picture it right there in front of you'
  const parts = components.map((c) => `the ${c.meaning} (${c.char}), ${c.imageKeyword}`)
  if (parts.length === 1) return `You see ${parts[0]}`
  return `You see ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

function readingClause(slots: AssemblerSlots): string {
  const base = `Say it aloud: ${slots.reading}.`
  return slots.readingPlay ? `${base} ${slots.readingPlay}` : base
}

function detailClause(slots: AssemblerSlots): string {
  return slots.personalDetail ? ` You notice ${slots.personalDetail}.` : ''
}

type Frame = (s: AssemblerSlots) => string

const FRAMES: Frame[] = [
  (s) =>
    `At ${s.locationName}, ${s.anchor} catches your eye. ${componentClause(s.components)} — ` +
    `and that is how you ${s.kanjiMeaning} (${s.kanji}) it.${detailClause(s)} ${readingClause(s)}`,
  // Anchor is emitted verbatim (not capitalized) even at this sentence start: anchors are
  // arbitrary user free-text, and 持 selects this frame, whose test pins the anchor substring.
  (s) =>
    `You are standing at ${s.locationName}. ${s.anchor} is right there. ` +
    `${componentClause(s.components)}. This is ${s.kanji} — to ${s.kanjiMeaning}.${detailClause(s)} ${readingClause(s)}`,
  (s) =>
    `${capitalize(s.anchor)} at ${s.locationName} pulls you in. ${componentClause(s.components)}, ` +
    `locking in ${s.kanji} (${s.kanjiMeaning}).${detailClause(s)} ${readingClause(s)}`,
]

function capitalize(str: string): string {
  return str.length === 0 ? str : str[0].toUpperCase() + str.slice(1)
}

/** Deterministic, model-free assembly of a personal mnemonic from structured slots. */
export function assembleTemplate(slots: AssemblerSlots): string {
  const frame = FRAMES[charHash(slots.kanji) % FRAMES.length]
  return frame(slots)
}
