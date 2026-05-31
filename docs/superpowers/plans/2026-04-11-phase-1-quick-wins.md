# Phase 1 — Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the dashboard JLPT bars, add a top performer badge to the leaderboard, and expand shared stats in the study group — four small wins that improve daily UX with minimal risk.

**Architecture:** Extract the progress page's `JlptGrid` into a shared component and reuse it on the dashboard. Extend the backend `getLeaderboard()` to return `dailyAverage` and add a client-side `isTopPerformer` flag. All changes are additive — no schema migrations needed.

**Tech Stack:** React Native (Expo Router), Fastify API, Zustand, drizzle-orm, Vitest

**Scope note:** Item 2 (Swipe Up/Down Grading — Watch Parity) is **already implemented** in `study.tsx` with 4-directional PanResponder gestures, animated badge overlays, card fly-off, haptic feedback, and hint text. It matches the watchOS spec exactly. This plan marks it as done and covers the remaining three items.

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `apps/mobile/src/components/ui/JlptProgressGrid.tsx` | Shared JLPT 4-color stacked bar component |
| `apps/api/test/unit/social/leaderboard.test.ts` | Unit tests for expanded leaderboard logic |

### Modified files
| File | Change |
|------|--------|
| `apps/mobile/app/(tabs)/index.tsx` | Replace inline JLPT rendering with `JlptProgressGrid`; add top performer badge + expanded stats to leaderboard rows |
| `apps/mobile/app/(tabs)/progress.tsx` | Replace inline `JlptGrid` + `jlptStyles` with imported `JlptProgressGrid` |
| `apps/mobile/src/hooks/useSocial.ts` | Update `LeaderboardEntry` type with `dailyAverage` |
| `apps/api/src/services/social.service.ts` | Add `dailyAverage` computation to `getLeaderboard()` |
| `ROADMAP.md` | Mark items 1–4 as Done |

---

### Task 1: Extract `JlptProgressGrid` shared component

**Files:**
- Create: `apps/mobile/src/components/ui/JlptProgressGrid.tsx`
- Modify: `apps/mobile/app/(tabs)/progress.tsx` (lines 698–732)

The progress page already has a clean `JlptGrid` component with its own `jlptStyles` stylesheet. We extract it into a shared component file so both screens can import it.

- [ ] **Step 1: Create the shared component**

Create `apps/mobile/src/components/ui/JlptProgressGrid.tsx`:

```tsx
import { View, Text, StyleSheet } from 'react-native'
import { colors, spacing, radius, typography } from '../../theme'
import { JLPT_LEVELS, JLPT_KANJI_COUNTS } from '@kanji-learn/shared'

export interface JlptBreakdown {
  learning: number
  reviewing: number
  remembered: number
  burned: number
}

interface Props {
  jlptProgress: Record<string, JlptBreakdown | number>
}

export function JlptProgressGrid({ jlptProgress }: Props) {
  return (
    <View style={styles.grid}>
      {JLPT_LEVELS.map((level) => {
        const levelTotal = JLPT_KANJI_COUNTS[level]
        const raw = jlptProgress[level]
        const bd: JlptBreakdown =
          typeof raw === 'number'
            ? { learning: 0, reviewing: 0, remembered: 0, burned: raw }
            : raw ?? { learning: 0, reviewing: 0, remembered: 0, burned: 0 }
        const total = bd.learning + bd.reviewing + bd.remembered + bd.burned
        return (
          <View key={level} style={styles.row}>
            <Text style={styles.level}>{level}</Text>
            <View style={styles.track}>
              {bd.learning > 0 && (
                <View
                  style={[
                    styles.seg,
                    { width: `${(bd.learning / levelTotal) * 100}%`, backgroundColor: colors.learning },
                  ]}
                />
              )}
              {bd.reviewing > 0 && (
                <View
                  style={[
                    styles.seg,
                    { width: `${(bd.reviewing / levelTotal) * 100}%`, backgroundColor: colors.reviewing },
                  ]}
                />
              )}
              {bd.remembered > 0 && (
                <View
                  style={[
                    styles.seg,
                    { width: `${(bd.remembered / levelTotal) * 100}%`, backgroundColor: colors.remembered },
                  ]}
                />
              )}
              {bd.burned > 0 && (
                <View
                  style={[
                    styles.seg,
                    { width: `${(bd.burned / levelTotal) * 100}%`, backgroundColor: colors.burned },
                  ]}
                />
              )}
            </View>
            <Text style={styles.count}>
              {total}/{levelTotal}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  grid: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  level: { ...typography.caption, color: colors.textMuted, width: 24, fontWeight: '700' },
  track: {
    flex: 1,
    height: 6,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.full,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  seg: { height: '100%' },
  count: { ...typography.caption, color: colors.textMuted, width: 64, textAlign: 'right' },
})
```

- [ ] **Step 2: Replace the inline `JlptGrid` in progress.tsx**

In `apps/mobile/app/(tabs)/progress.tsx`:

Remove the local `JlptGrid` function (lines ~698–723) and the `jlptStyles` stylesheet (lines ~725–732).

Add this import near the top:
```tsx
import { JlptProgressGrid } from '../../src/components/ui/JlptProgressGrid'
```

Replace all references from `<JlptGrid jlptProgress={...} />` to `<JlptProgressGrid jlptProgress={...} />`.

- [ ] **Step 3: Verify progress page still renders correctly**

Run on device/simulator:
```bash
cd apps/mobile && npx expo start
```
Navigate to the Progress tab. Confirm the JLPT bars look identical to before (same 6px bars, same colors, same count format).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/ui/JlptProgressGrid.tsx apps/mobile/app/\(tabs\)/progress.tsx
git commit -m "refactor(mobile): extract JlptProgressGrid shared component"
```

---

### Task 2: Replace dashboard JLPT section with `JlptProgressGrid`

**Files:**
- Modify: `apps/mobile/app/(tabs)/index.tsx` (lines ~430–481, ~768–790)

The dashboard currently renders JLPT bars inline with a badge, projected date, and "% mastered" label. We replace this with the compact `JlptProgressGrid` to match the progress page style while keeping the card wrapper, title, and info button.

- [ ] **Step 1: Replace the JLPT card body**

In `apps/mobile/app/(tabs)/index.tsx`, add the import:
```tsx
import { JlptProgressGrid } from '../../src/components/ui/JlptProgressGrid'
```

Replace the JLPT card body (lines ~434–478) — the `<View style={styles.jlptRows}>` block and everything inside it — with:
```tsx
{summary.jlptProgress && (
  <View style={styles.card}>
    <View style={styles.cardRow}>
      <Text style={styles.cardTitle}>JLPT Progress</Text>
      <InfoButton id="jlpt" activeInfo={activeInfo} onToggle={toggleInfo} />
    </View>

    {activeInfo === 'jlpt' && <InfoPanel sections={INFO_JLPT_PROGRESS} />}

    <JlptProgressGrid jlptProgress={summary.jlptProgress} />
  </View>
)}
```

Note: the guard condition changes from `summary.velocity.levelProjections.length > 0` to `summary.jlptProgress` — the progress data is always available when analytics loads, and we no longer need projections.

- [ ] **Step 2: Remove unused dashboard JLPT styles**

Delete these styles from the `StyleSheet.create` call (lines ~768–790):
- `jlptRows`, `jlptRow`, `jlptBadge`, `jlptBadgeText`, `jlptBarCol`, `jlptBarTrack`, `jlptBarFill`, `jlptBarLabels`, `jlptCount`, `jlptPct`, `jlptDate`

- [ ] **Step 3: Verify dashboard renders correctly**

Run on device/simulator. Navigate to the Dashboard tab. Confirm:
- JLPT Progress card shows the compact bar grid (text label + bar + count)
- Info button still toggles the help panel
- No visual artifacts from removed styles

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/\(tabs\)/index.tsx
git commit -m "feat(mobile): match dashboard JLPT bars to progress page style"
```

---

### Task 3: Add `dailyAverage` to leaderboard backend

**Files:**
- Modify: `apps/api/src/services/social.service.ts` (lines ~5–28, ~149–220)
- Create: `apps/api/test/unit/social/leaderboard.test.ts`

Extend `LeaderboardEntry` with a `dailyAverage` field (average reviews per active day over the last 30 days). This is computed from the same `daily_stats` data already fetched for streak calculation.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/unit/social/leaderboard.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

/**
 * computeDailyAverage — average reviews per active day in the window.
 * An "active day" is one where reviewed > 0.
 * Returns 0 if no active days.
 */
function computeDailyAverage(stats: { date: string; reviewed: number }[]): number {
  // Stub — will be imported from social.service.ts after implementation
  throw new Error('not implemented')
}

describe('computeDailyAverage', () => {
  it('returns 0 for empty stats', () => {
    expect(computeDailyAverage([])).toBe(0)
  })

  it('returns the single day value for one active day', () => {
    expect(computeDailyAverage([{ date: '2026-04-11', reviewed: 25 }])).toBe(25)
  })

  it('averages across multiple active days', () => {
    const stats = [
      { date: '2026-04-11', reviewed: 30 },
      { date: '2026-04-10', reviewed: 20 },
      { date: '2026-04-09', reviewed: 10 },
    ]
    expect(computeDailyAverage(stats)).toBe(20)
  })

  it('ignores days with zero reviews', () => {
    const stats = [
      { date: '2026-04-11', reviewed: 40 },
      { date: '2026-04-10', reviewed: 0 },
      { date: '2026-04-09', reviewed: 20 },
    ]
    // Only 2 active days: (40 + 20) / 2 = 30
    expect(computeDailyAverage(stats)).toBe(30)
  })

  it('rounds to nearest integer', () => {
    const stats = [
      { date: '2026-04-11', reviewed: 10 },
      { date: '2026-04-10', reviewed: 11 },
      { date: '2026-04-09', reviewed: 12 },
    ]
    // (10 + 11 + 12) / 3 = 11
    expect(computeDailyAverage(stats)).toBe(11)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && pnpm vitest run test/unit/social/leaderboard.test.ts
```
Expected: FAIL with "not implemented"

- [ ] **Step 3: Implement `computeDailyAverage` and export it**

In `apps/api/src/services/social.service.ts`, add this exported function near `computeStreak` (around line 249):

```typescript
export function computeDailyAverage(stats: { date: string; reviewed: number }[]): number {
  const activeDays = stats.filter((s) => s.reviewed > 0)
  if (activeDays.length === 0) return 0
  const total = activeDays.reduce((sum, s) => sum + s.reviewed, 0)
  return Math.round(total / activeDays.length)
}
```

- [ ] **Step 4: Update the test to import the real function**

Replace the stub `computeDailyAverage` in the test file:

```typescript
import { computeDailyAverage } from '../../../src/services/social.service.js'
```

Remove the local stub function.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/api && pnpm vitest run test/unit/social/leaderboard.test.ts
```
Expected: 5 tests PASS

- [ ] **Step 6: Add `dailyAverage` to `LeaderboardEntry` and `getLeaderboard()`**

In `apps/api/src/services/social.service.ts`:

Update the `LeaderboardEntry` interface (around line 18):
```typescript
export interface LeaderboardEntry {
  userId: string
  displayName: string | null
  streak: number
  totalReviewed: number
  totalBurned: number
  dailyAverage: number  // <-- add this
  isMe: boolean
}
```

In the `getLeaderboard()` method, where each entry is assembled (the loop that builds the return array), add `dailyAverage` using `computeDailyAverage`:

```typescript
const dailyAverage = computeDailyAverage(userStats)
```

Add `dailyAverage` to the returned entry object alongside `streak`.

- [ ] **Step 7: Run full test suite to verify no regressions**

```bash
cd apps/api && pnpm test
```
Expected: all tests pass (94+ tests)

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/social.service.ts apps/api/test/unit/social/leaderboard.test.ts
git commit -m "feat(api): add dailyAverage to leaderboard entries"
```

---

### Task 4: Add top performer badge to leaderboard UI

**Files:**
- Modify: `apps/mobile/app/(tabs)/index.tsx` (lines ~557–593, styles ~809–825)

The top performer is the rank-1 entry in the leaderboard. This is determined client-side — no API change needed. We add a trophy icon and subtle gold highlight to the #1 row.

- [ ] **Step 1: Add top performer indicator to leaderboard row**

In `apps/mobile/app/(tabs)/index.tsx`, find the leaderboard row rendering (around line 571). Replace the rank display for the first entry:

Change:
```tsx
<Text style={styles.lbRank}>{i + 1}</Text>
```

To:
```tsx
{i === 0 ? (
  <Ionicons name="trophy" size={16} color={colors.accent} style={styles.lbRank} />
) : (
  <Text style={styles.lbRank}>{i + 1}</Text>
)}
```

- [ ] **Step 2: Add gold highlight style for rank 1 row**

Add a new style alongside `lbRowMe` (around line 818):
```typescript
lbRowTop: {
  backgroundColor: colors.accent + '11',
  borderRadius: radius.sm,
  borderLeftWidth: 2,
  borderLeftColor: colors.accent,
},
```

Apply it to the leaderboard row:

Change:
```tsx
<View key={entry.userId} style={[styles.lbRow, entry.isMe && styles.lbRowMe]}>
```

To:
```tsx
<View key={entry.userId} style={[styles.lbRow, i === 0 && styles.lbRowTop, entry.isMe && styles.lbRowMe]}>
```

Note: `lbRowMe` comes after `lbRowTop` so the current-user highlight takes precedence when the user IS the top performer (both styles merge, with `lbRowMe`'s background winning).

- [ ] **Step 3: Add "Top Performer" label next to rank 1 name**

After the display name for rank 1, add a small label. Find the name rendering (around line 576):

Change:
```tsx
<Text style={[styles.lbName, entry.isMe && styles.lbNameMe]} numberOfLines={1}>
  {entry.displayName ?? 'Unknown'}
  {entry.isMe ? ' (you)' : ''}
</Text>
```

To:
```tsx
<Text style={[styles.lbName, entry.isMe && styles.lbNameMe]} numberOfLines={1}>
  {entry.displayName ?? 'Unknown'}
  {entry.isMe ? ' (you)' : ''}
  {i === 0 ? ' · Top Performer' : ''}
</Text>
```

- [ ] **Step 4: Verify on device/simulator**

Run the app. Navigate to the Dashboard. Confirm:
- Rank 1 shows a trophy icon instead of "1"
- Rank 1 row has a subtle gold left border and background tint
- "Top Performer" label appears after the name
- If current user is rank 1, both gold and blue highlights merge cleanly
- Ranks 2+ look unchanged

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/\(tabs\)/index.tsx
git commit -m "feat(mobile): add top performer badge to leaderboard"
```

---

### Task 5: Expand shared stats in leaderboard UI

**Files:**
- Modify: `apps/mobile/src/hooks/useSocial.ts` (line ~18)
- Modify: `apps/mobile/app/(tabs)/index.tsx` (lines ~581–583)

Display `dailyAverage` in the leaderboard row alongside existing stats.

- [ ] **Step 1: Update the `LeaderboardEntry` type in the hook**

In `apps/mobile/src/hooks/useSocial.ts`, add `dailyAverage` to the interface:

```typescript
export interface LeaderboardEntry {
  userId: string
  displayName: string | null
  streak: number
  totalReviewed: number
  totalBurned: number
  dailyAverage: number  // <-- add this
  isMe: boolean
}
```

- [ ] **Step 2: Update the leaderboard row stats display**

In `apps/mobile/app/(tabs)/index.tsx`, find the stats line (around line 581):

Change:
```tsx
<Text style={styles.lbStats}>
  {entry.totalReviewed.toLocaleString()} reviewed · {entry.totalBurned.toLocaleString()} burned
</Text>
```

To:
```tsx
<Text style={styles.lbStats}>
  {entry.dailyAverage}/day · {entry.totalBurned.toLocaleString()} mastered · {entry.streak}d streak
</Text>
```

This replaces the raw `totalReviewed` (a big number that's hard to interpret) with three actionable metrics:
- **`/day`** — average daily effort (easy to compare)
- **mastered** — kanji burned (quality signal)
- **streak** — consistency (moves from the separate flame column into the stats line)

- [ ] **Step 3: Remove the separate streak flame column**

Since streak is now in the stats line, remove the separate flame column to declutter. Find the streak rendering (around line 585):

Delete:
```tsx
<View style={styles.lbStreak}>
  <Ionicons name="flame" size={14} color={entry.streak > 0 ? colors.accent : colors.textMuted} />
  <Text style={[styles.lbStreakText, { color: entry.streak > 0 ? colors.accent : colors.textMuted }]}>
    {entry.streak}
  </Text>
</View>
```

Remove unused styles: `lbStreak`, `lbStreakText`.

- [ ] **Step 4: Update the INFO_LEADERBOARD help text**

Find `INFO_LEADERBOARD` (around line 152). Update the sections to reflect the new stat display:

Replace the "Reviewed" section (around line 158):
```typescript
{ label: 'Avg / Day', text: 'Average reviews per active day over the last 30 days. Reflects sustainable pace.' },
```

The "Burned", "Streak", and "Competition Note" sections stay the same.

- [ ] **Step 5: Verify on device/simulator**

Run the app. Navigate to the Dashboard. Confirm:
- Leaderboard rows show: `{avg}/day · {burned} mastered · {streak}d streak`
- No separate flame column on the right
- Info panel describes the new metrics
- Numbers look reasonable (e.g. `15/day · 42 mastered · 7d streak`)

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/hooks/useSocial.ts apps/mobile/app/\(tabs\)/index.tsx
git commit -m "feat(mobile): expand leaderboard with daily average and inline streak"
```

---

### Task 6: Update roadmap and final verification

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Mark Phase 1 items as done**

In `ROADMAP.md`, update the Phase 1 section:

```markdown
## Phase 1 — Quick Wins ✅ COMPLETE
*Deployed 2026-04-11.*

| # | Enhancement | Impact | Backend | Status |
|---|------------|--------|---------|--------|
| 1 | Dashboard JLPT Bars: Match Progress Page Style | Med | No | ✅ Done |
| 2 | Swipe Up/Down Grading (Watch Parity) | Med | No | ✅ Done (pre-existing) |
| 3 | Study Group: Top Performer Badge | Med | Yes | ✅ Done |
| 4 | Study Group: Expanded Shared Stats | Med | Yes | ✅ Done |
```

- [ ] **Step 2: Run the full API test suite**

```bash
cd apps/api && pnpm test
```
Expected: all tests pass including the new `leaderboard.test.ts`

- [ ] **Step 3: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: mark Phase 1 quick wins complete"
```
