import { eq } from 'drizzle-orm'
import {
  learnerStateCache,
  userKanjiProgress,
  reviewLogs,
  reviewSessions,
  dailyStats,
} from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import { scaffoldForSignals, type ScaffoldLevel } from './constants'

// ─── Shared input/output types ───────────────────────────────────────────────

export interface RawLearnerInputs {
  userId: string
  currentStreakDays: number
  longestStreakDays: number
  totalKanjiSeen: number
  totalKanjiBurned: number
  reviewsLast7Days: number[] // length 7
  reviewsPrev7Days: number[] // length 7
  recentAccuracy: {
    meaning: number
    reading: number
    writing: number
    voice: number
    compound: number
  }
  activeLeechCount: number
  consecutiveFailures: number
  lastSessionAt: Date | null
}

export interface ComputedLearnerState {
  userId: string
  currentStreakDays: number
  longestStreakDays: number
  totalKanjiSeen: number
  totalKanjiBurned: number
  velocityTrend: 'accelerating' | 'steady' | 'decelerating' | 'inactive'
  weakestModality: 'meaning' | 'reading' | 'writing' | 'voice' | 'compound'
  scaffoldLevel: ScaffoldLevel
  activeLeechCount: number
  lastSessionAt: Date | null
  recentAccuracy: number // average across modalities, 0–1
  computedAt: Date
}

// ─── Pure computation — no db access, easy to test ──────────────────────────

export function computeLearnerState(input: RawLearnerInputs): ComputedLearnerState {
  const last = sum(input.reviewsLast7Days)
  const prev = sum(input.reviewsPrev7Days)

  const velocityTrend: ComputedLearnerState['velocityTrend'] = (() => {
    if (last === 0) return 'inactive'
    if (prev === 0) return last > 0 ? 'accelerating' : 'inactive'
    const ratio = last / prev
    if (ratio >= 1.2) return 'accelerating'
    if (ratio <= 0.8) return 'decelerating'
    return 'steady'
  })()

  const modalityEntries = Object.entries(input.recentAccuracy) as Array<
    [ComputedLearnerState['weakestModality'], number]
  >
  const weakestModality = modalityEntries.reduce((worst, cur) =>
    cur[1] < worst[1] ? cur : worst
  )[0]

  const avgAccuracy =
    modalityEntries.reduce((acc, [, v]) => acc + v, 0) / modalityEntries.length

  const scaffoldLevel = scaffoldForSignals({
    recentAccuracy: avgAccuracy,
    consecutiveFailures: input.consecutiveFailures,
    streakDays: input.currentStreakDays,
  })

  return {
    userId: input.userId,
    currentStreakDays: input.currentStreakDays,
    longestStreakDays: input.longestStreakDays,
    totalKanjiSeen: input.totalKanjiSeen,
    totalKanjiBurned: input.totalKanjiBurned,
    velocityTrend,
    weakestModality,
    scaffoldLevel,
    activeLeechCount: input.activeLeechCount,
    lastSessionAt: input.lastSessionAt,
    recentAccuracy: Number(avgAccuracy.toFixed(4)),
    computedAt: new Date(),
  }
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0)
}

// ─── Service class ───────────────────────────────────────────────────────────

export class LearnerStateService {
  constructor(private readonly db: Db) {}

  async refreshState(userId: string): Promise<ComputedLearnerState> {
    const raw = await this.loadRawInputs(userId)
    const computed = computeLearnerState(raw)
    await this.persist(computed)
    return computed
  }

  async getState(userId: string): Promise<ComputedLearnerState | null> {
    const row = await this.db.query.learnerStateCache.findFirst({
      where: eq(learnerStateCache.userId, userId),
    })
    if (!row) return null
    return {
      userId: row.userId,
      currentStreakDays: row.currentStreakDays,
      longestStreakDays: row.longestStreakDays,
      totalKanjiSeen: row.totalKanjiSeen,
      totalKanjiBurned: row.totalKanjiBurned,
      velocityTrend: row.velocityTrend,
      weakestModality: row.weakestModality,
      // learner_state_cache.scaffold_level is a notNull text column with a
      // 'medium' default, so `row.scaffoldLevel` is always a string. The cast
      // narrows text to the ScaffoldLevel literal union.
      scaffoldLevel: row.scaffoldLevel as ScaffoldLevel,
      activeLeechCount: row.activeLeechCount,
      lastSessionAt: row.lastSessionAt,
      recentAccuracy: row.recentAccuracy,
      computedAt: row.updatedAt,
    }
  }

  private async loadRawInputs(userId: string): Promise<RawLearnerInputs> {
    // 1. Kanji progress aggregate — seen, burned
    const progress = await this.db.query.userKanjiProgress.findMany({
      where: eq(userKanjiProgress.userId, userId),
    })
    const totalKanjiSeen = progress.filter((p) => p.status !== 'unseen').length
    const totalKanjiBurned = progress.filter((p) => p.status === 'burned').length

    // 2. Recent review logs — cap at 500 so this query doesn't balloon for
    // heavy users; the computation only needs enough to cover accuracy,
    // leeches, and consecutive failures.
    const recentLogs = await this.db.query.reviewLogs.findMany({
      where: eq(reviewLogs.userId, userId),
      orderBy: (rl, { desc }) => desc(rl.reviewedAt),
      limit: 500,
    })

    // 3. Active leeches — count per-kanji failures (quality<3) where the
    // kanji is not yet burned. LEECH_LAPSE_THRESHOLD is 3 (from constants.ts).
    // The schema has no lapseCount column so we derive from reviewLogs.quality.
    const burnedIds = new Set(progress.filter((p) => p.status === 'burned').map((p) => p.kanjiId))
    const lapseCounts = new Map<number, number>()
    for (const log of recentLogs) {
      if (log.quality < 3) {
        lapseCounts.set(log.kanjiId, (lapseCounts.get(log.kanjiId) ?? 0) + 1)
      }
    }
    let activeLeechCount = 0
    for (const [kanjiId, count] of lapseCounts) {
      if (count >= 3 && !burnedIds.has(kanjiId)) activeLeechCount += 1
    }

    // 4. Per-modality accuracy — treat quality >= 3 as correct (SM-2).
    // Note: reviewTypeEnum only has meaning/reading/writing/compound (no voice).
    // voice defaults to 1.0 when no logs exist for it.
    const recentAccuracy = computeModalityAccuracy(recentLogs)

    // 5. Consecutive failures — walk recentLogs (already desc by reviewedAt)
    // counting the prefix of quality<3 before the first pass.
    let consecutiveFailures = 0
    for (const log of recentLogs) {
      if (log.quality >= 3) break
      consecutiveFailures += 1
    }

    // 6. Daily stats — single query for the full per-user history. We need
    // this for both streak derivation (all history) and the 14-day velocity
    // window. Phase 0: bounded by the user's lifetime use; Phase 1 will
    // replace streak derivation with a materialized counter updated
    // incrementally on each new day, and we'll only need a 14-day window here.
    const allStats = await this.db.query.dailyStats.findMany({
      where: eq(dailyStats.userId, userId),
      orderBy: (ds, { asc }) => asc(ds.date),
    })

    // Velocity window: isolate the last 14 days (or fewer if the user has
    // less history) for the two 7-day buckets.
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    const fourteenDaysAgoStr = fourteenDaysAgo.toISOString().slice(0, 10)
    const recentStats = allStats.filter((s) => s.date >= fourteenDaysAgoStr)
    const last7 = recentStats.slice(-7).map((s) => s.reviewed)
    const prev7 = recentStats.slice(-14, -7).map((s) => s.reviewed)
    const pad = (arr: number[]) => [...arr, ...Array(Math.max(0, 7 - arr.length)).fill(0)]

    // 7. Streak derivation walks allStats.
    const { currentStreakDays, longestStreakDays } = deriveStreaks(allStats)

    // 8. Last session timestamp from reviewSessions.
    const lastSessionRow = await this.db.query.reviewSessions.findFirst({
      where: eq(reviewSessions.userId, userId),
      orderBy: (rs, { desc }) => desc(rs.startedAt),
    })
    const lastSessionAt = lastSessionRow?.completedAt ?? lastSessionRow?.startedAt ?? null

    return {
      userId,
      currentStreakDays,
      longestStreakDays,
      totalKanjiSeen,
      totalKanjiBurned,
      reviewsLast7Days: pad(last7),
      reviewsPrev7Days: pad(prev7),
      recentAccuracy,
      activeLeechCount,
      consecutiveFailures,
      lastSessionAt,
    }
  }

  private async persist(state: ComputedLearnerState): Promise<void> {
    const values = {
      userId: state.userId,
      currentStreakDays: state.currentStreakDays,
      longestStreakDays: state.longestStreakDays,
      totalKanjiSeen: state.totalKanjiSeen,
      totalKanjiBurned: state.totalKanjiBurned,
      velocityTrend: state.velocityTrend,
      weakestModality: state.weakestModality,
      scaffoldLevel: state.scaffoldLevel,
      activeLeechCount: state.activeLeechCount,
      lastSessionAt: state.lastSessionAt,
      recentAccuracy: state.recentAccuracy,
      updatedAt: state.computedAt,
    }
    await this.db
      .insert(learnerStateCache)
      .values(values)
      .onConflictDoUpdate({
        target: learnerStateCache.userId,
        set: {
          currentStreakDays: values.currentStreakDays,
          longestStreakDays: values.longestStreakDays,
          totalKanjiSeen: values.totalKanjiSeen,
          totalKanjiBurned: values.totalKanjiBurned,
          velocityTrend: values.velocityTrend,
          weakestModality: values.weakestModality,
          scaffoldLevel: values.scaffoldLevel,
          activeLeechCount: values.activeLeechCount,
          lastSessionAt: values.lastSessionAt,
          recentAccuracy: values.recentAccuracy,
          updatedAt: values.updatedAt,
        },
      })
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute per-modality accuracy from review logs.
 * reviewTypeEnum only defines meaning/reading/writing/compound — no voice.
 * The voice bucket defaults to 1.0 when no voice logs exist.
 */
function computeModalityAccuracy(
  logs: Array<{ reviewType: string; quality: number }>
): RawLearnerInputs['recentAccuracy'] {
  const counts = {
    meaning: { c: 0, t: 0 },
    reading: { c: 0, t: 0 },
    writing: { c: 0, t: 0 },
    voice: { c: 0, t: 0 },
    compound: { c: 0, t: 0 },
  }
  for (const log of logs) {
    const key = log.reviewType as keyof typeof counts
    if (!(key in counts)) continue
    counts[key].t += 1
    if (log.quality >= 3) counts[key].c += 1
  }
  const ratio = (x: { c: number; t: number }) => (x.t === 0 ? 1.0 : x.c / x.t)
  return {
    meaning: ratio(counts.meaning),
    reading: ratio(counts.reading),
    writing: ratio(counts.writing),
    voice: ratio(counts.voice),
    compound: ratio(counts.compound),
  }
}

/**
 * Walk dailyStats chronologically to compute the longest consecutive-day
 * streak, and walk backwards from the most recent row to compute the current
 * streak. A day counts toward the streak only if `reviewed > 0`. Consecutive
 * means the date is exactly one day later than the previous streak day.
 *
 * Phase 0: O(n) over all of a user's dailyStats rows. Phase 1 will replace
 * this with a materialized counter updated incrementally on each new day.
 */
function deriveStreaks(
  stats: Array<{ date: string; reviewed: number }>
): { currentStreakDays: number; longestStreakDays: number } {
  if (stats.length === 0) return { currentStreakDays: 0, longestStreakDays: 0 }

  // Longest — forward walk
  let longest = 0
  let run = 0
  let prev: Date | null = null
  for (const s of stats) {
    if (s.reviewed <= 0) {
      run = 0
      prev = null
      continue
    }
    const d = new Date(s.date + 'T00:00:00Z')
    if (prev && d.getTime() - prev.getTime() === 86_400_000) {
      run += 1
    } else {
      run = 1
    }
    if (run > longest) longest = run
    prev = d
  }

  // Current — backward walk from most recent row. A streak is still alive
  // if the most recent reviewed>0 row is today or yesterday (UTC).
  let current = 0
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const yesterdayStr = new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10)
  const reversed = [...stats].reverse()
  // Find the most recent reviewed>0 row.
  const mostRecent = reversed.find((s) => s.reviewed > 0)
  if (!mostRecent) return { currentStreakDays: 0, longestStreakDays: longest }
  if (mostRecent.date !== todayStr && mostRecent.date !== yesterdayStr) {
    return { currentStreakDays: 0, longestStreakDays: longest }
  }

  // Walk backwards from mostRecent, counting consecutive days.
  let cursor = new Date(mostRecent.date + 'T00:00:00Z')
  const byDate = new Map(stats.map((s) => [s.date, s]))
  while (true) {
    const key = cursor.toISOString().slice(0, 10)
    const row = byDate.get(key)
    if (!row || row.reviewed <= 0) break
    current += 1
    cursor = new Date(cursor.getTime() - 86_400_000)
  }

  return { currentStreakDays: current, longestStreakDays: longest }
}
