import type { JlptLevel } from './types'

// ─── Grid ───────────────────────────────────────────────────────────────────

const THETA_MIN = -4
const THETA_MAX = 4
const THETA_STEPS = 81

export const THETA_GRID: readonly number[] = Array.from(
  { length: THETA_STEPS },
  (_, i) => THETA_MIN + (i * (THETA_MAX - THETA_MIN)) / (THETA_STEPS - 1),
)

/** Fixed 4-option multiple-choice guessing floor — never estimated (spec §7). */
export const GUESSING_C = 0.25

export type Posterior = number[] // length THETA_STEPS, sums to 1

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

/** P(correct response | theta, b) — the Rasch model with a fixed guessing floor. */
export function probCorrect(theta: number, b: number): number {
  return GUESSING_C + (1 - GUESSING_C) * sigmoid(theta - b)
}

function normalize(weights: number[]): Posterior {
  const sum = weights.reduce((a, w) => a + w, 0)
  return weights.map((w) => w / sum)
}

/** A Gaussian prior over the grid, centered on `priorMean` (0 = the N3
 *  boundary, per spec §7 — the stated prior preserving today's "starts at
 *  N3" behavior). `priorSd` wide by default so the prior is flat-ish. */
export function initPosterior(priorMean = 0, priorSd = 1.5): Posterior {
  return normalize(THETA_GRID.map((t) => Math.exp(-0.5 * ((t - priorMean) / priorSd) ** 2)))
}

export function updatePosterior(posterior: Posterior, b: number, correct: boolean): Posterior {
  const likelihoods = THETA_GRID.map((theta) => {
    const p = probCorrect(theta, b)
    return correct ? p : 1 - p
  })
  return normalize(posterior.map((prior, i) => prior * likelihoods[i]))
}

export function thetaMean(posterior: Posterior): number {
  return posterior.reduce((sum, p, i) => sum + p * THETA_GRID[i], 0)
}

/** theta at the given cumulative-probability quantile (0..1). */
export function thetaAtQuantile(posterior: Posterior, quantile: number): number {
  let cumulative = 0
  for (let i = 0; i < posterior.length; i++) {
    cumulative += posterior[i]
    if (cumulative >= quantile) return THETA_GRID[i]
  }
  return THETA_GRID[THETA_GRID.length - 1]
}

export const CONSERVATIVE_QUANTILE = 0.25

/**
 * P(knows item of difficulty b) — deliberately excludes the guessing
 * constant `c` (spec §7.1: c models the RESPONSE, not knowledge) and is
 * evaluated at a pessimistic quantile of theta's posterior, not its mean
 * (spec §7.2: over-estimating seeds a card that silently vanishes for
 * weeks; under-estimating costs a few seconds of "yes, I know this one").
 */
export function pKnows(posterior: Posterior, b: number, quantile = CONSERVATIVE_QUANTILE): number {
  const thetaQ = thetaAtQuantile(posterior, quantile)
  return sigmoid(thetaQ - b)
}

/** Width of the central credible interval at the given level (0.8 = 80%). */
export function credibleIntervalWidth(posterior: Posterior, level = 0.8): number {
  const tail = (1 - level) / 2
  const lo = thetaAtQuantile(posterior, tail)
  const hi = thetaAtQuantile(posterior, 1 - tail)
  return hi - lo
}

export interface StopConfig {
  floorItems: number
  capItems: number
  /** Max acceptable 80% credible interval width — spec §7.4's "fits inside ±1 JLPT band". */
  bandWidth: number
}

export function shouldStop(posterior: Posterior, itemsAsked: number, config: StopConfig): boolean {
  if (itemsAsked < config.floorItems) return false
  if (itemsAsked >= config.capItems) return true
  return credibleIntervalWidth(posterior, 0.8) <= config.bandWidth
}

/**
 * The band containing theta — spec §7.5: the single level estimate, derived
 * from the posterior, replacing the three-estimates-that-can-disagree
 * problem (spec §3b). `boundaries` are the midpoints between adjacent JLPT
 * levels' mean difficulty (computed by the caller from `kanji_difficulty`),
 * sorted ascending, length = levels.length - 1.
 */
export function inferredLevel(theta: number, boundaries: number[], levels: JlptLevel[]): JlptLevel {
  let idx = 0
  while (idx < boundaries.length && theta >= boundaries[idx]) idx++
  return levels[idx]
}

export interface LevelBands {
  boundaries: number[]
  /** The levels those boundaries separate — ALWAYS pass this to inferredLevel,
   *  never the caller's full level list. */
  levels: JlptLevel[]
}

/**
 * Level bands from each level's mean difficulty (spec §7.5), returning the
 * boundaries and their labels as one aligned pair.
 *
 * The pairing is the whole point. A level with no entries cannot have a mean,
 * so it drops out — and when it does, `boundaries` describes a SHORTER ladder
 * than the caller's full level list. Reading the resulting index out of the
 * full list is off by however many levels were dropped below it: B146 shipped
 * exactly that, and a strong learner (asked only N3/N2/N1, because item
 * selection maximises Fisher information near their ability) was told N4.
 *
 * Callers should pass the whole difficulty CORPUS, not the items a test
 * happened to ask. Bands are a property of the corpus; deriving them from an
 * adaptive sample makes every learner's yardstick their own answers.
 */
export function levelBands(
  entries: readonly { b: number; level: JlptLevel | null }[],
  levels: readonly JlptLevel[],
): LevelBands {
  const bandLevels: JlptLevel[] = []
  const means: number[] = []

  for (const level of levels) {
    const at = entries.filter((e) => e.level === level)
    if (at.length === 0) continue
    bandLevels.push(level)
    means.push(at.reduce((sum, e) => sum + e.b, 0) / at.length)
  }

  const boundaries: number[] = []
  for (let i = 0; i < means.length - 1; i++) boundaries.push((means[i] + means[i + 1]) / 2)

  return { boundaries, levels: bandLevels }
}

// ─── Adaptive engine ────────────────────────────────────────────────────────

export interface AskedItem {
  kanjiId: number
  itemType: 'meaning' | 'reading'
  b: number
  correct: boolean
}

export interface PlacementEngineConfig {
  floorCharacters: number
  capCharacters: number
  bandWidth: number
  /** delta_read — not used by the engine directly (the caller supplies the
   *  already-offset b for reading items) but kept on the config so callers
   *  building item requests have one place to read it from. */
  readingOffset: number
  /** For a retest: the stored, staleness-widened posterior (spec §10). */
  priorPosterior?: Posterior
  /** For a first placement: where the flat prior is centered (spec §7 — 0 = N3). */
  priorMean?: number
}

/**
 * Client-side adaptive test driver. Tracks a running posterior for item
 * selection and stopping ONLY — this is a UX convenience, not the source of
 * truth for writes. The server (placement.service.ts) independently
 * recomputes theta from the raw submitted responses at complete-time and
 * never trusts a client-reported value (spec §4.1's never-overwrite rule
 * depends on this).
 */
export class PlacementEngine {
  private posterior: Posterior
  private readonly askedItems: AskedItem[] = []
  private readonly askedKanjiIds = new Set<number>()
  private charactersAsked = 0
  private readonly config: PlacementEngineConfig

  constructor(config: PlacementEngineConfig) {
    this.config = config
    this.posterior = config.priorPosterior ?? initPosterior(config.priorMean ?? 0)
  }

  getThetaHat(): number {
    return thetaMean(this.posterior)
  }

  getPosterior(): Posterior {
    return [...this.posterior]
  }

  getAskedKanjiIds(): number[] {
    return Array.from(this.askedKanjiIds)
  }

  getAskedItems(): AskedItem[] {
    return [...this.askedItems]
  }

  recordItemResult(kanjiId: number, itemType: 'meaning' | 'reading', b: number, correct: boolean): void {
    this.posterior = updatePosterior(this.posterior, b, correct)
    this.askedItems.push({ kanjiId, itemType, b, correct })
    this.askedKanjiIds.add(kanjiId)
    if (itemType === 'reading') this.charactersAsked++
  }

  isDone(): boolean {
    return shouldStop(this.posterior, this.charactersAsked, {
      floorItems: this.config.floorCharacters,
      capItems: this.config.capCharacters,
      bandWidth: this.config.bandWidth,
    })
  }
}
