/** Which assembly tier produced a mnemonic story. */
export type AssemblyTier = 'template' | 'on_device' | 'cloud'

/** One radical/component, enriched for teaching + mnemonic assembly. */
export interface RadicalEntry {
  /** The radical/component character, e.g. '扌'. */
  char: string
  /** Japanese dictionary name (romaji), e.g. 'tehen'. Reused from the mobile RADICAL_NAMES set. */
  name: string
  /** Short English meaning for teaching + assembly, e.g. 'hand'. */
  meaning: string
  /** Vivid image phrase for weaving into a story, e.g. 'a hand reaching out, grasping'. */
  imageKeyword: string
}

/** Structured inputs the assembler (all three tiers) weaves into a story. */
export interface AssemblerSlots {
  kanji: string
  kanjiMeaning: string
  /** Kana reading, e.g. 'もつ'. */
  reading: string
  /** Resolved, mapped components (unmapped ones are filtered out before assembly). */
  components: RadicalEntry[]
  /** Reverse-geocoded place name OR the user's free-text location. */
  locationName: string
  /** Q1 answer — the environmental anchor, e.g. 'a yellow vending machine'. */
  anchor: string
  /** Q2 answer — optional personal detail, e.g. 'a blue shirt'. */
  personalDetail?: string
  /** Q3 answer — optional reading wordplay seed. */
  readingPlay?: string
}

// ── Cadence constants (§6) ────────────────────────────────────────────────
export const EFFECTIVENESS_DEFAULT = 0.5
export const EFFECTIVENESS_ALPHA = 0.4
export const DEEPEN_MIN_REINFORCEMENTS = 2
export const DEEPEN_SCORE_FLOOR = 0.35

// ── Trigger (§4.1) ────────────────────────────────────────────────────────
/** A kanji reviewed in the just-finished session, with the signals the trigger needs. */
export interface ReviewedCard {
  kanjiId: number
  kanji: string
  /** Graded Again/Hard, or failed the quiz leg, this session. */
  struggledToday: boolean
  /** Lifetime FSRS lapse count. */
  lapses: number
  /** Whether a co-created hook already exists for this kanji. */
  hasHook: boolean
}

/** Minimum lifetime lapses to count as "chronically lapsing". */
export const CHRONIC_LAPSE_THRESHOLD = 3

/** The single action the post-session Buddy moment should take. */
export type BuddyMomentAction =
  | { kind: 'reinforce'; kanjiId: number }
  | { kind: 'create'; kanjiId: number }
  | { kind: 'none' }
