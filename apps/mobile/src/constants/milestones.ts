// ─── Milestone definitions ────────────────────────────────────────────────────
// All milestones are computed client-side from analytics data already available.
// No new API or DB changes required.

export interface Milestone {
  id: string
  label: string
  emoji: string
  achieved: boolean
}

interface MilestoneInput {
  burned: number
  streakDays: number
  totalSeen: number
  jlptProgress: Record<string, { learning: number; reviewing: number; remembered: number; burned: number }>
}

// JLPT level totals (Jouyou kanji per level)
const JLPT_TOTALS: Record<string, number> = { N5: 80, N4: 169, N3: 361, N2: 415, N1: 1232 }

export function computeMilestones(input: MilestoneInput): Milestone[] {
  const { burned, streakDays, totalSeen, jlptProgress } = input

  const jlptBurned = (level: string) =>
    jlptProgress[level]?.burned ?? 0

  return [
    // ── First steps
    { id: 'first_seen',    label: '1 kanji seen',       emoji: '👁️',  achieved: totalSeen >= 1 },
    { id: 'seen_100',      label: '100 kanji seen',      emoji: '📚', achieved: totalSeen >= 100 },
    { id: 'seen_500',      label: '500 kanji seen',      emoji: '📖', achieved: totalSeen >= 500 },
    { id: 'seen_1000',     label: '1,000 kanji seen',    emoji: '🗂️', achieved: totalSeen >= 1000 },

    // ── Burns
    { id: 'first_burn',    label: 'First burn',          emoji: '🔥', achieved: burned >= 1 },
    { id: 'burn_10',       label: '10 kanji burned',     emoji: '🔥', achieved: burned >= 10 },
    { id: 'burn_50',       label: '50 kanji burned',     emoji: '🔥', achieved: burned >= 50 },
    { id: 'burn_100',      label: '100 kanji burned',    emoji: '💯', achieved: burned >= 100 },
    { id: 'burn_500',      label: '500 kanji burned',    emoji: '⚡', achieved: burned >= 500 },
    { id: 'burn_1000',     label: '1,000 kanji burned',  emoji: '🌟', achieved: burned >= 1000 },

    // ── JLPT level completions (all burned)
    { id: 'n5_complete',   label: 'N5 Complete 🎌',      emoji: '🎌', achieved: jlptBurned('N5') >= JLPT_TOTALS.N5 },
    { id: 'n4_complete',   label: 'N4 Complete',         emoji: '🏅', achieved: jlptBurned('N4') >= JLPT_TOTALS.N4 },
    { id: 'n3_complete',   label: 'N3 Complete',         emoji: '🥈', achieved: jlptBurned('N3') >= JLPT_TOTALS.N3 },
    { id: 'n2_complete',   label: 'N2 Complete',         emoji: '🥇', achieved: jlptBurned('N2') >= JLPT_TOTALS.N2 },
    { id: 'n1_complete',   label: 'N1 Complete',         emoji: '🏆', achieved: jlptBurned('N1') >= JLPT_TOTALS.N1 },

    // ── Streaks
    { id: 'streak_7',      label: '7-day streak',        emoji: '⚡', achieved: streakDays >= 7 },
    { id: 'streak_30',     label: '30-day streak',       emoji: '🗓️', achieved: streakDays >= 30 },
    { id: 'streak_100',    label: '100-day streak',      emoji: '💎', achieved: streakDays >= 100 },
    { id: 'streak_365',    label: '365-day streak',      emoji: '🌏', achieved: streakDays >= 365 },
  ]
}
