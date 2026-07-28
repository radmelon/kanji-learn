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
  /** ISO timestamp the hook was created, when there is one.
   *
   *  Used only by the reinforce freshness guard. Absent (on an older client,
   *  or a card with no hook) means "unknown age", which the guard treats as
   *  old enough — failing toward the previous behaviour rather than silently
   *  suppressing every reinforce offer. */
  hookCreatedAt?: string
}

/** Minimum lifetime lapses to count as "chronically lapsing". */
export const CHRONIC_LAPSE_THRESHOLD = 3

/**
 * How old a hook must be before it can be reinforce-challenged.
 *
 * Owner decision, 2026-07-28. Building a hook for a kanji you just graded
 * Again made it instantly eligible for its own reinforce challenge, so the
 * app could ask a learner to recall a story they wrote four minutes earlier.
 * That is the same flaw as the immediate quick-check deleted the same day
 * (B-218): a test with no failure mode, run so soon after creation that it
 * measures nothing — and whose result still feeds effectivenessScore, where a
 * 👍 inflates the EMA for a hook that has never actually been retained.
 *
 * A calendar day is the smallest interval that guarantees at least one
 * intervening sleep, which is what makes the retrieval real rather than a
 * read-back of working memory.
 */
export const HOOK_REINFORCE_MIN_AGE_MS = 24 * 60 * 60 * 1000

/** The single action the post-session Buddy moment should take. */
export type BuddyMomentAction =
  | { kind: 'reinforce'; kanjiId: number }
  | { kind: 'create'; kanjiId: number }
  | { kind: 'none' }

// ── Persisted co-creation context (spec §10.1) ─────────────────────────────
// Written to mnemonics.cocreation_context (jsonb). The mobile flow assembles
// this client-side; the API persists it verbatim. The db schema mirrors this
// shape inline in an $type<>() annotation (packages/db has no shared dep).

/** One additive layer of a co-created hook. Deepening appends a layer; nothing is discarded. */
export interface CoCreationLayer {
  questions: string[]
  answers: string[]
  anchor?: string
  source: 'environment' | 'known_knowledge'
}

/** Full structured context behind a co-created mnemonic story. */
export interface CoCreationContext {
  layers: CoCreationLayer[]
  layerCount: number
  locationName?: string
  components: Array<{ char: string; meaning: string }>
  generatedBy: AssemblyTier
  /** ISO timestamp; set on create/deepen, cleared after the first story→kanji quiz. */
  mnemonicQuizDueAt?: string
  timeOfDay?: string
}
