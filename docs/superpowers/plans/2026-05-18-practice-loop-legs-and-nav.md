# Practice Loop — Loop Legs & Nav (Plan B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the flashcard grade, route each kanji through writing and speaking practice inside the study session — and remove the standalone Write & Speak tabs so the loop is the only practice surface.

**Architecture:** The study session gains a per-kanji *leg* sub-state (`flashcard → writing → speaking`). After a flashcard is graded, the review store decides — from the card's status and the grade — whether the kanji needs the writing+speaking legs. New kanji and weak (Again/Hard) review kanji do; Good/Easy review kanji end immediately. The existing `WritingPractice` and `VoiceEvaluator` components are reused unchanged, wrapped by two thin new leg components. The standalone `writing.tsx` / `voice.tsx` tab screens are deleted. The review-queue API gains a guaranteed new-kanji allowance so a heavy review day still introduces new material.

**Tech Stack:** React Native / Expo (TypeScript), Zustand, expo-router, Fastify + Drizzle/Postgres (API), Jest.

**Plan context:** This is **Plan B of three** implementing the Three-Modality Practice Loop spec (`docs/superpowers/specs/2026-05-17-practice-loop-design.md`). Plan A (shipped) made the session time-boxed on a minutes budget. Plan B adds the writing/speaking loop legs and removes the Write/Speak tabs. **Plan C** adds the quiz leg (the "maybe slipping" → quiz routing in spec §2/§4), promotes Browse to a tab, and adds the Session Complete modality breakdown.

---

## Scope

**In scope (Plan B)**
- Per-kanji loop routing: new kanji and Again/Hard review kanji run `flashcard → writing → speaking`; Good/Easy review kanji end after the flashcard.
- Two leg components reusing `WritingPractice` and `VoiceEvaluator`.
- The review store's per-kanji leg state machine; the time-box check moves to the end of a kanji's full path (never a mid-leg cut).
- Removing the **Write** and **Speak** tabs (deleting `writing.tsx` / `voice.tsx`).
- The guaranteed new-kanji allowance in `GET /v1/review/queue` (deferred to Plan B by Plan A).

**Out of scope (deferred)**
- **The quiz leg** and the "maybe slipping" flag (spec §2/§4) — **Plan C**.
- **Promoting Browse to a tab** (spec §1) — **Plan C**.
- **Session Complete modality breakdown** (spec §5) — **Plan C** (the "telemetry" slice). Plan B leaves Session Complete unchanged.
- **The Ready screen** (spec §5 screen 1) — not in Plan B's "loop legs + nav" charter; deferred.
- **Weak-drill / missed-drill legs.** "Drill Weak Spots" and "Drill missed cards" are count-bounded mini-drills (`goalMinutes === 0`). They stay flashcard-only. Leg routing is gated on `goalMinutes > 0` (the main time-boxed loop).

## Design decisions (made during planning — flag any disagreement before executing)

1. **Speaking leg uses `VoiceEvaluator`'s legacy kanji-reading layout** (no `voicePrompt`). The standalone Speak tab fed `VoiceEvaluator` a `voicePrompt` (vocab word) sourced from a separate `/v1/review/reading-queue` fetch. Re-plumbing that into the loop would mean an extra fetch and a queue-API change. `VoiceEvaluator` already supports — and ships — a `voicePrompt`-less kanji-reading layout with the full progressive-hint ladder. Plan B uses that; the richer vocab-word layout is deferred to Plan C (which already touches the queue API).
2. **Leg routing is gated on `goalMinutes > 0`** so weak/missed drills stay flashcard-only without a new flag.
3. **No changes to `WritingPractice` / `VoiceEvaluator` internals.** The leg components wrap them and render their own "Continue" affordance, so neither component's prop surface changes.
4. **Guaranteed new-kanji allowance is front-loaded.** A small batch of new kanji (`NEW_KANJI_FLOOR = 4`) is placed at the *head* of the queue, then due reviews (most-overdue first), then any remaining new cards. A strict due-first order would push new kanji past the time budget on a heavy review day, defeating the spec's "forward progress never fully stalls".

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `apps/api/src/services/srs.service.ts` | Modify | `getReviewQueue` reserves a guaranteed new-kanji slice via the new pure `planQueueSlots` helper |
| `apps/api/test/unit/planQueueSlots.test.ts` | Create | Unit tests for the `planQueueSlots` slot arithmetic |
| `apps/mobile/src/components/study/WritingLeg.tsx` | Create | Writing leg — wraps `WritingPractice` for one kanji |
| `apps/mobile/src/components/study/SpeakingLeg.tsx` | Create | Speaking leg — wraps `VoiceEvaluator` for one kanji |
| `apps/mobile/src/stores/review.store.ts` | Modify | `leg` state + `endKanji` / `completeWritingLeg` / `completeSpeakingLeg`; `submitResult` routes |
| `apps/mobile/app/(tabs)/study.tsx` | Modify | Render the writing/speaking legs based on `leg` |
| `apps/mobile/app/(tabs)/_layout.tsx` | Modify | Remove the Write and Speak `Tabs.Screen` entries |
| `apps/mobile/app/(tabs)/writing.tsx` | Delete | Standalone Write tab — absorbed into the loop |
| `apps/mobile/app/(tabs)/voice.tsx` | Delete | Standalone Speak tab — absorbed into the loop |

---

## Task 1: API — guaranteed new-kanji allowance

**Files:**
- Create: `apps/api/test/unit/planQueueSlots.test.ts`
- Modify: `apps/api/src/services/srs.service.ts`

Today `getReviewQueue` fills the queue with due reviews first (`.limit(limit)`), then new/unseen cards only fill `remaining = limit - dueCards.length` slots. On a heavy review day `remaining` is 0 and **no new kanji appear at all**. Spec §3 calls for a small guaranteed new-kanji allowance. This task adds a pure slot-allocation helper, unit-tests it, and wires it into `getReviewQueue`.

- [ ] **Step 1: Inspect the API test harness**

The repo has at least one API test at `apps/api/test/integration/social-mute.test.ts`. Before writing the test file, determine the test runner: read `apps/api/package.json` (the `test` script and devDependencies) and skim `apps/api/test/integration/social-mute.test.ts` for the import style (`jest` vs `vitest`, `describe`/`it`/`expect`). Write `planQueueSlots.test.ts` in **that** style. The assertions in Step 2 are fixed; only the harness boilerplate (imports, config) follows the existing pattern.

- [ ] **Step 2: Write the failing unit test**

Create `apps/api/test/unit/planQueueSlots.test.ts`. Import `planQueueSlots` from the SRS service and assert this exact behaviour (adapt only the `import`/`describe` boilerplate to the runner found in Step 1):

```ts
import { planQueueSlots } from '../../src/services/srs.service'

describe('planQueueSlots', () => {
  it('reserves the new-kanji floor on a heavy review day', () => {
    // 100 due, plenty of new, limit 50, floor 4
    expect(planQueueSlots(100, 100, 50, 4)).toEqual({ guaranteedNew: 4, dueKeep: 46, fillNew: 0 })
  })
  it('lets new cards fill leftover slots when due is light', () => {
    expect(planQueueSlots(10, 100, 50, 4)).toEqual({ guaranteedNew: 4, dueKeep: 10, fillNew: 36 })
  })
  it('fills entirely with new cards when nothing is due', () => {
    expect(planQueueSlots(0, 100, 50, 4)).toEqual({ guaranteedNew: 4, dueKeep: 0, fillNew: 46 })
  })
  it('caps the floor at the number of new cards actually available', () => {
    expect(planQueueSlots(100, 2, 50, 4)).toEqual({ guaranteedNew: 2, dueKeep: 48, fillNew: 0 })
  })
  it('gives all slots to due when there are no new cards', () => {
    expect(planQueueSlots(100, 0, 50, 4)).toEqual({ guaranteedNew: 0, dueKeep: 50, fillNew: 0 })
  })
  it('never exceeds the limit when due + new are both small', () => {
    const s = planQueueSlots(20, 5, 50, 4)
    expect(s).toEqual({ guaranteedNew: 4, dueKeep: 20, fillNew: 1 })
    expect(s.guaranteedNew + s.dueKeep + s.fillNew).toBeLessThanOrEqual(50)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run the API test suite (the command found in Step 1, e.g. `pnpm --filter @kanji-learn/api test` or a path-scoped invocation).
Expected: FAIL — `planQueueSlots` is not exported.

- [ ] **Step 4: Implement and export `planQueueSlots`**

In `apps/api/src/services/srs.service.ts`, add this exported function and constant at module scope (after the imports / `selectVoicePrompt`, before `export class SrsService`):

```ts
/** Guaranteed minimum new/unseen kanji in a review queue, so a heavy review
 *  day still introduces some new material (Practice Loop spec §3). */
export const NEW_KANJI_FLOOR = 4

/**
 * Pure slot allocation for the review queue. Given how many due and new cards
 * are available, returns how many of each to use:
 *   - `guaranteedNew` — new kanji front-loaded so the time-boxed session
 *     reaches them even on a heavy review day.
 *   - `dueKeep` — due reviews, filling the bulk of the queue.
 *   - `fillNew` — extra new cards filling any slots left over.
 * The three counts never sum to more than `limit`.
 */
export function planQueueSlots(
  dueCount: number,
  newCount: number,
  limit: number,
  newFloor: number,
): { guaranteedNew: number; dueKeep: number; fillNew: number } {
  const guaranteedNew = Math.min(newFloor, newCount, limit)
  const dueKeep = Math.min(dueCount, limit - guaranteedNew)
  const fillNew = Math.min(newCount - guaranteedNew, limit - guaranteedNew - dueKeep)
  return { guaranteedNew, dueKeep, fillNew }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run the API test suite again. Expected: PASS — all six `planQueueSlots` cases green.

- [ ] **Step 6: Wire `planQueueSlots` into `getReviewQueue`**

In `getReviewQueue` (same file): the new-cards query is currently gated on `remaining = limit - dueCards.length` and uses `.limit(remaining)`. Change it so new cards are always fetched up to `limit` (the helper decides how many to keep). Replace the step-2 block — the `const remaining = ...` line and the `const newCards = remaining > 0 ? ... : []` expression — with an unconditional fetch:

```ts
    // 2. New unseen cards — fetched up to `limit`; planQueueSlots decides how
    //    many to actually use (a guaranteed floor is front-loaded — spec §3).
    const newCardRows = await this.db
      .select({
        kanjiId: kanji.id,
        character: kanji.character,
        jlptLevel: kanji.jlptLevel,
        meanings: kanji.meanings,
        kunReadings: kanji.kunReadings,
        onReadings: kanji.onReadings,
        exampleVocab: kanji.exampleVocab,
        exampleSentences: kanji.exampleSentences,
        strokeCount: kanji.strokeCount,
        radicals: kanji.radicals,
        nelsonClassic: kanji.nelsonClassic,
        nelsonNew: kanji.nelsonNew,
        morohashiIndex: kanji.morohashiIndex,
        morohashiVolume: kanji.morohashiVolume,
        morohashiPage: kanji.morohashiPage,
      })
      .from(kanji)
      .where(
        sql`${kanji.id} NOT IN (
          SELECT kanji_id FROM user_kanji_progress WHERE user_id = ${userId}
        )`
      )
      .orderBy(asc(kanji.jlptLevel), asc(kanji.jlptOrder))
      .limit(limit)

    // Allocate slots: a guaranteed new-kanji batch is front-loaded, then due
    // reviews, then any leftover slots go to more new cards.
    const slots = planQueueSlots(dueCards.length, newCardRows.length, limit, NEW_KANJI_FLOOR)
    const guaranteedNewRows = newCardRows.slice(0, slots.guaranteedNew)
    const dueRows = dueCards.slice(0, slots.dueKeep)
    const fillNewRows = newCardRows.slice(slots.guaranteedNew, slots.guaranteedNew + slots.fillNew)
```

Then update the final queue assembly (the `const queue: ReviewQueueItem[] = [ ...dueCards.map(...), ...newCards.map(...), ...burnedChecks.map(...) ]` array). The new/due `.map()` blocks are unchanged in body — only the array they iterate and the order changes. The final array must be: **guaranteed new first, then due, then fill new, then burned checks.** Extract the new-card mapping into a local `mapNew` and the due mapping into a local `mapDue` (the exact `.map((c) => ({ ... }))` callbacks already in the file), then assemble:

```ts
    const queue: ReviewQueueItem[] = [
      ...guaranteedNewRows.map(mapNew),
      ...dueRows.map(mapDue),
      ...fillNewRows.map(mapNew),
      ...burnedChecks.map(mapBurned),
    ]
```

Keep each `map*` callback byte-identical to the current inline callbacks (the `toArr<>()` guards, `pickReviewType`, `status`/`readingStage` defaults). Only the *grouping into named functions and the array order* change. Do not change the burned-checks query or its mapping.

- [ ] **Step 7: Typecheck the API**

Run: `pnpm --filter @kanji-learn/api typecheck`
Expected: no **new** errors. (`apps/api` has one pre-existing unrelated error in `test/integration/social-mute.test.ts:25` — a `FastifyRegisterOptions` typecheck error that exists on `main` independently. Do not fix it; do not let it mask a new error you introduced.)

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/srs.service.ts apps/api/test/unit/planQueueSlots.test.ts
git commit -m "$(cat <<'EOF'
feat(api): guarantee a new-kanji allowance in the review queue

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 2: WritingLeg component

**Files:**
- Create: `apps/mobile/src/components/study/WritingLeg.tsx`

The writing leg wraps the existing `WritingPractice` component for a single kanji. `WritingPractice` already records its own attempt (`POST /v1/review/writing`) when the user submits — so this wrapper only renders the drill and shows a "Continue" action once a result is in. `WritingPractice` is **not** passed `onNext`, so it renders no internal next-button; the wrapper owns the continue affordance.

`WritingPractice`'s prop interface (for reference — do not modify it):
```ts
interface Props {
  kanjiId: number; character: string; meanings: string[]; jlptLevel: string
  strokeCount: number; kunReadings?: string[]; onReadings?: string[]
  index: number; total: number; isLastCard?: boolean
  onResult: (score: number, passed: boolean) => void
  onNext?: () => void
  onDrawingChange?: (isDrawing: boolean) => void
}
```

- [ ] **Step 1: Create `WritingLeg.tsx`**

Create `apps/mobile/src/components/study/WritingLeg.tsx`:

```tsx
import { useState, useCallback } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import type { ReviewQueueItem } from '@kanji-learn/shared'
import { WritingPractice } from '../writing/WritingPractice'
import { colors, spacing, radius, typography } from '../../theme'

interface Props {
  item: ReviewQueueItem
  /** 1-based position of this kanji in the session queue (display only). */
  sessionIndex: number
  sessionTotal: number
  minutesLeft: number | null
  onClose: () => void
  onComplete: () => void
}

/**
 * The writing leg of the Practice Loop. Wraps WritingPractice for one kanji.
 * WritingPractice records its own attempt (POST /v1/review/writing); this
 * wrapper shows the drill and a "Continue" action once a result is in.
 */
export function WritingLeg({ item, sessionIndex, sessionTotal, minutesLeft, onClose, onComplete }: Props) {
  // WritingPractice's canvas PanResponder uses capture-phase; the parent
  // ScrollView must be disabled while drawing or the gesture is stolen.
  const [scrollEnabled, setScrollEnabled] = useState(true)
  const [submitted, setSubmitted] = useState(false)

  const handleDrawingChange = useCallback((isDrawing: boolean) => {
    setScrollEnabled(!isDrawing)
  }, [])

  const handleResult = useCallback(() => {
    setSubmitted(true)
  }, [])

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Ionicons name="close" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.legLabel}>Write it</Text>
        <Text style={styles.counter}>{sessionIndex}/{sessionTotal}</Text>
        {minutesLeft !== null && (
          <Text style={styles.timeLeft}>{minutesLeft}m left</Text>
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={scrollEnabled}
      >
        <WritingPractice
          key={item.kanjiId}
          kanjiId={item.kanjiId}
          character={item.character}
          meanings={item.meanings}
          jlptLevel={item.jlptLevel}
          strokeCount={item.strokeCount}
          kunReadings={item.kunReadings}
          onReadings={item.onReadings}
          index={sessionIndex}
          total={sessionTotal}
          onResult={handleResult}
          onDrawingChange={handleDrawingChange}
        />

        {submitted && (
          <TouchableOpacity style={styles.continueBtn} onPress={onComplete} activeOpacity={0.85}>
            <Text style={styles.continueText}>Continue to speaking</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.sm,
  },
  closeBtn: { padding: spacing.xs },
  legLabel: { ...typography.h3, color: colors.textPrimary, flex: 1 },
  counter: { ...typography.caption, color: colors.textMuted, minWidth: 36, textAlign: 'right' },
  timeLeft: { ...typography.caption, color: colors.textMuted, minWidth: 48, textAlign: 'right' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl },
  continueBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.primary, paddingVertical: spacing.md,
    borderRadius: radius.lg, marginHorizontal: spacing.md, marginTop: spacing.md,
  },
  continueText: { ...typography.h3, color: '#fff' },
})
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @kanji-learn/mobile typecheck`
Expected: no errors. (`WritingLeg` is not imported anywhere yet — that happens in Task 5. An unused-export does not error.)

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/study/WritingLeg.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): add WritingLeg — the loop's writing practice leg

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 3: SpeakingLeg component

**Files:**
- Create: `apps/mobile/src/components/study/SpeakingLeg.tsx`

The speaking leg wraps `VoiceEvaluator` for a single kanji. `VoiceEvaluator` records its own attempt (`POST /v1/review/voice`). This wrapper manages the progressive-hint ladder (`attempts` → reveal flags via `computeReveals`) and the success / bail transitions, then calls `onComplete` to advance the loop. It mirrors the per-kanji logic of the old `voice.tsx` tab screen.

`VoiceEvaluator`'s prop interface (for reference — do not modify it):
```ts
export interface EvalResult {
  correct: boolean; quality: number; feedback: string
  normalizedSpoken: string; closestCorrect: string
}
interface Props {
  kanjiId: number; character: string; correctReadings: string[]
  readingLabel?: string; onResult?: (result: EvalResult) => void
  strict?: boolean; voicePrompt?: VoicePrompt
  attempts: number; revealHiragana: boolean; revealPitch: boolean; revealVocabMeaning: boolean
}
```

`VoiceSuccessCard` props (used here): `word`, `reading`, `targetKanji`, `kanjiMeaning`, `vocabMeaning`, `isLast`, `onNext`. `NotQuiteBanner` props: `visible`, `onAutoDismiss`. `computeReveals(attempts)` returns `{ showKunOn, showKanjiMeaning, showHiragana, forcePitch, showVocabMeaning, canBail }`.

- [ ] **Step 1: Create `SpeakingLeg.tsx`**

Create `apps/mobile/src/components/study/SpeakingLeg.tsx`:

```tsx
import { useState, useCallback } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import type { ReviewQueueItem } from '@kanji-learn/shared'
import { VoiceEvaluator } from '../voice/VoiceEvaluator'
import type { EvalResult } from '../voice/VoiceEvaluator'
import { computeReveals } from '../voice/voiceReveal.logic'
import { NotQuiteBanner } from '../voice/NotQuiteBanner'
import { VoiceSuccessCard } from '../voice/VoiceSuccessCard'
import { colors, spacing, radius, typography } from '../../theme'

interface Props {
  item: ReviewQueueItem
  /** 1-based position of this kanji in the session queue (display only). */
  sessionIndex: number
  sessionTotal: number
  minutesLeft: number | null
  onClose: () => void
  onComplete: () => void
}

/** Strip an okurigana suffix from a kun reading (e.g. 'み.る' → 'みる'). */
const stripOkurigana = (r: string) => r.replace(/\..+$/, '')

/**
 * The speaking leg of the Practice Loop. Wraps VoiceEvaluator for one kanji.
 * VoiceEvaluator records its own attempt (POST /v1/review/voice). This wrapper
 * runs the progressive-hint ladder (attempts → reveal flags) and the success /
 * bail transitions, then calls onComplete to advance the loop.
 *
 * v1 renders VoiceEvaluator's legacy kanji-reading layout (no voicePrompt) —
 * the richer vocab-word layout is deferred to Plan C (see plan §"Design
 * decisions"). The progressive-hint ladder works in either layout.
 */
export function SpeakingLeg({ item, sessionIndex, sessionTotal, minutesLeft, onClose, onComplete }: Props) {
  const [attempts, setAttempts] = useState(0)
  const [evaluated, setEvaluated] = useState(false)
  const [lastResult, setLastResult] = useState<EvalResult | null>(null)
  const [showInterstitial, setShowInterstitial] = useState(false)

  const reveals = computeReveals(attempts)

  const correctReadings = [
    ...item.kunReadings.map(stripOkurigana),
    ...item.onReadings,
  ].filter(Boolean)
  const readingLabel = item.kunReadings.length > 0 ? 'kun reading' : 'on reading'

  const handleResult = useCallback((result: EvalResult) => {
    setEvaluated(true)
    setLastResult(result)
    if (!result.correct) {
      setAttempts((a) => a + 1)
      setShowInterstitial(true)
    }
  }, [])

  const isCorrect = evaluated && lastResult?.correct === true

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Ionicons name="close" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.legLabel}>Say it</Text>
        <Text style={styles.counter}>{sessionIndex}/{sessionTotal}</Text>
        {minutesLeft !== null && (
          <Text style={styles.timeLeft}>{minutesLeft}m left</Text>
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.cardHeader}>
          <View style={styles.levelBadge}>
            <Text style={styles.levelText}>{item.jlptLevel}</Text>
          </View>
          <Text style={styles.character}>{item.character}</Text>
        </View>

        {/* Reading chips — revealed from try 2 onward. */}
        {reveals.showKunOn && (
          <View style={styles.readingChips}>
            {item.kunReadings.length > 0 && (
              <View style={styles.readingGroup}>
                <Text style={styles.readingGroupLabel}>Kun</Text>
                {item.kunReadings.slice(0, 3).map((r) => (
                  <View key={r} style={styles.readingChip}>
                    <Text style={styles.readingChipText}>{r}</Text>
                  </View>
                ))}
              </View>
            )}
            {item.onReadings.length > 0 && (
              <View style={styles.readingGroup}>
                <Text style={styles.readingGroupLabel}>On</Text>
                {item.onReadings.slice(0, 3).map((r) => (
                  <View key={r} style={styles.readingChip}>
                    <Text style={styles.readingChipText}>{r}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Kanji meaning — also revealed from try 2 onward. */}
        {reveals.showKanjiMeaning && (
          <Text style={styles.meaningText}>{item.meanings.slice(0, 3).join(', ')}</Text>
        )}

        {isCorrect ? (
          <VoiceSuccessCard
            word={item.character}
            reading={item.kunReadings[0] ?? item.onReadings[0] ?? ''}
            targetKanji={item.character}
            kanjiMeaning={item.meanings.slice(0, 3).join(', ')}
            vocabMeaning=""
            isLast={false}
            onNext={onComplete}
          />
        ) : (
          <View style={styles.evaluatorWrapper}>
            <VoiceEvaluator
              key={item.kanjiId}
              kanjiId={item.kanjiId}
              character={item.character}
              correctReadings={correctReadings}
              readingLabel={readingLabel}
              onResult={handleResult}
              attempts={attempts}
              revealHiragana={reveals.showHiragana}
              revealPitch={reveals.forcePitch}
              revealVocabMeaning={reveals.showVocabMeaning}
            />
            <NotQuiteBanner
              visible={showInterstitial}
              onAutoDismiss={() => setShowInterstitial(false)}
            />
            {/* Bail option — appears from try 4+ (attempts >= 3). */}
            {reveals.canBail && (
              <TouchableOpacity style={styles.continueBtn} onPress={onComplete} activeOpacity={0.85}>
                <Text style={styles.continueText}>Continue</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.sm,
  },
  closeBtn: { padding: spacing.xs },
  legLabel: { ...typography.h3, color: colors.textPrimary, flex: 1 },
  counter: { ...typography.caption, color: colors.textMuted, minWidth: 36, textAlign: 'right' },
  timeLeft: { ...typography.caption, color: colors.textMuted, minWidth: 48, textAlign: 'right' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, gap: spacing.lg },
  cardHeader: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.md },
  levelBadge: {
    backgroundColor: colors.bgSurface, paddingHorizontal: spacing.sm,
    paddingVertical: 2, borderRadius: radius.sm,
  },
  levelText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  character: { fontSize: 96, color: colors.textPrimary, textAlign: 'center' },
  meaningText: { ...typography.h3, color: colors.textSecondary, textAlign: 'center' },
  readingChips: { flexDirection: 'row', gap: spacing.md, justifyContent: 'center', flexWrap: 'wrap' },
  readingGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  readingGroupLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
  readingChip: {
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 3,
  },
  readingChipText: { ...typography.reading, color: colors.textSecondary },
  evaluatorWrapper: {
    backgroundColor: colors.bgCard, borderRadius: radius.xl,
    borderWidth: 1, borderColor: colors.border, padding: spacing.xl,
  },
  continueBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.primary, paddingVertical: spacing.md,
    borderRadius: radius.lg, marginTop: spacing.sm,
  },
  continueText: { ...typography.h3, color: '#fff' },
})
```

- [ ] **Step 2: Verify the imported names exist**

Confirm these imports resolve (read the files if unsure):
- `VoiceEvaluator` and the `EvalResult` type — `apps/mobile/src/components/voice/VoiceEvaluator.tsx`
- `computeReveals` — `apps/mobile/src/components/voice/voiceReveal.logic.ts`
- `NotQuiteBanner` — `apps/mobile/src/components/voice/NotQuiteBanner.tsx`
- `VoiceSuccessCard` — `apps/mobile/src/components/voice/VoiceSuccessCard.tsx`

If `VoiceSuccessCard` or `NotQuiteBanner` have a different prop shape than used above, adapt the call site to the real props (these components are reused exactly as the old `voice.tsx` used them — cross-check against `voice.tsx` in git history if needed: it was deleted in Task 6, so check before that, or `git show HEAD:apps/mobile/app/(tabs)/voice.tsx`). Report any mismatch as a concern.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @kanji-learn/mobile typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/study/SpeakingLeg.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): add SpeakingLeg — the loop's speaking practice leg

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 4: Review store — per-kanji leg state machine

**Files:**
- Modify: `apps/mobile/src/stores/review.store.ts`

The store gains a `leg` sub-state for the current kanji. `submitResult` (the flashcard grade) records the result and then either routes to the writing leg or ends the kanji. The time-box check moves out of `submitResult` into a new `endKanji` action so a session never cuts off mid-leg.

> **Sequencing note:** This task changes `submitResult` so a new/weak kanji sets `leg: 'writing'` instead of advancing. Until Task 5 teaches `study.tsx` to render the legs, the app is transiently incomplete (grading a new kanji would leave the flashcard on screen). Task 5 must follow immediately. This mirrors the Plan A Task 5→6 transient state.

- [ ] **Step 1: Add the `LegName` type and `leg` field to the interface**

In `apps/mobile/src/stores/review.store.ts`, just above the `interface ReviewState {` line, add:

```ts
/** The current kanji's position within the Practice Loop. */
export type LegName = 'flashcard' | 'writing' | 'speaking'
```

Inside `interface ReviewState`, after the `goalMinutes: number` field and its doc comment, add the `leg` field and the three new action signatures (place them after the existing `loadMissedQueue` / `reset` signatures):

```ts
  /** Minutes budget for the current session; 0 = count-bounded (weak/missed drills) */
  goalMinutes: number
  /** The current kanji's leg in the loop. New + Again/Hard kanji run flashcard
   *  → writing → speaking; Good/Easy review kanji stay on 'flashcard'. */
  leg: LegName

  loadQueue: (goalMinutes: number) => Promise<void>
  submitResult: (result: ReviewResult) => void
  undoLastResult: () => boolean
  loadWeakQueue: (limit?: number) => Promise<boolean>
  finishSession: () => Promise<{ burned: number; studyTimeMs: number; confidencePct: number } | null>
  syncPendingSessions: () => Promise<void>
  loadMissedQueue: () => boolean
  reset: () => void
  /** Advance past the current kanji: bump the index, run the time-box check,
   *  reset the leg. Called when a kanji's full path is done. */
  endKanji: () => void
  /** Writing leg finished → move to the speaking leg. */
  completeWritingLeg: () => void
  /** Speaking leg finished → advance to the next kanji. */
  completeSpeakingLeg: () => void
```

(The `loadQueue`…`reset` lines above are shown only for placement context — they are unchanged. Keep the existing `goalMinutes` doc comment.)

- [ ] **Step 2: Initialise `leg` in the store body**

In the `create<ReviewState>` initial state, after `goalMinutes: 0,` add:

```ts
  goalMinutes: 0,
  leg: 'flashcard',
```

- [ ] **Step 3: Reset `leg` in every queue-load and reset path**

Add `leg: 'flashcard'` to four `set(...)` calls so every fresh session/queue starts on the flashcard leg:

- In `loadQueue`, the **first** `set(...)` call (the one with `isLoading: true, isComplete: false, currentIndex: 0, results: [], ...`): add `leg: 'flashcard'`.
- In `loadWeakQueue`, the `set(...)` that sets `isWeakDrill: true` and `goalMinutes: 0`: add `leg: 'flashcard'`.
- In `loadMissedQueue`, the `set(...)` that sets `queue: missedCards, ...`: add `leg: 'flashcard'`.
- In `reset`, the `set(...)`: add `leg: 'flashcard'`.

- [ ] **Step 4: Reset `leg` in `undoLastResult`**

In `undoLastResult`, the `set({ results: newResults, currentIndex: prevIndex, isComplete: false })` call — add `leg: 'flashcard'` so undoing a graded card returns cleanly to the flashcard:

```ts
    set({ results: newResults, currentIndex: prevIndex, isComplete: false, leg: 'flashcard' })
```

- [ ] **Step 5: Rewrite `submitResult` and add the three leg actions**

Replace the entire `submitResult` function with the version below, and add `endKanji`, `completeWritingLeg`, `completeSpeakingLeg` directly after it:

```ts
  submitResult: (result) => {
    const { results, queue, currentIndex, studyStartMs } = get()
    const newResults = [...results, result]
    const item = queue[currentIndex]

    // The flashcard grade is final at grade time — record + persist it now.
    set({ results: newResults })
    storage.setItem(KEY_PROGRESS, { userId: 'current', results: newResults, studyStartMs })

    // Per-kanji loop routing — main loop only (weak/missed drills have
    // goalMinutes 0 and stay flashcard-only). A new kanji, or a review kanji
    // graded Again(1)/Hard(3), runs the writing → speaking legs before the
    // loop advances. Good/Easy review kanji end immediately.
    const { goalMinutes } = get()
    const needsLegs =
      goalMinutes > 0 &&
      (item?.status === 'unseen' || result.quality === 1 || result.quality === 3)

    if (needsLegs) {
      set({ leg: 'writing' })
    } else {
      get().endKanji()
    }
  },

  endKanji: () => {
    const { currentIndex, queue, studyStartMs, goalMinutes } = get()
    const nextIndex = currentIndex + 1

    // The session ends when the queue is exhausted OR — for a time-boxed
    // session (goalMinutes > 0) — when the minutes budget has elapsed. This
    // check runs only when a kanji's FULL path is done, so a session never
    // cuts off mid-writing or mid-speaking.
    const overBudget =
      goalMinutes > 0 && Date.now() - studyStartMs >= goalMinutes * 60_000

    set({
      currentIndex: nextIndex,
      isComplete: nextIndex >= queue.length || overBudget,
      leg: 'flashcard',
    })
  },

  completeWritingLeg: () => set({ leg: 'speaking' }),

  completeSpeakingLeg: () => get().endKanji(),
```

Note what changed from the old `submitResult`: it no longer advances `currentIndex` or sets `isComplete` itself — that logic moved into `endKanji`. For a non-legs kanji, `submitResult` calls `endKanji()`, so the behaviour is identical to before. For a legs kanji, it sets `leg: 'writing'` and waits.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @kanji-learn/mobile typecheck`
Expected: NO errors. `study.tsx` calls `submitResult` (signature unchanged) and does not yet use `leg` — that is added in Task 5. If typecheck reports an error in `study.tsx`, it is a genuine mismatch — read it; it should not occur.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/stores/review.store.ts
git commit -m "$(cat <<'EOF'
feat(mobile): add the per-kanji loop leg state machine to the review store

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 5: study.tsx — render the loop legs

**Files:**
- Modify: `apps/mobile/app/(tabs)/study.tsx`

`study.tsx` renders the writing and speaking legs (Tasks 2 & 3) based on the store's `leg` (Task 4). When `leg === 'flashcard'` the existing flashcard UI renders unchanged.

- [ ] **Step 1: Import the leg components**

Near the other `src/components/study/...` imports in `study.tsx` (e.g. the `SessionComplete` / `MnemonicNudgeSheet` imports), add:

```ts
import { WritingLeg } from '../../src/components/study/WritingLeg'
import { SpeakingLeg } from '../../src/components/study/SpeakingLeg'
```

- [ ] **Step 2: Pull the leg state and actions from the store**

`study.tsx` has one `useReviewStore()` destructure (the multi-line `const { queue, currentIndex, ... } = useReviewStore()`). Extend it to also pull `leg`, `completeWritingLeg`, and `completeSpeakingLeg`:

```ts
  const { queue, currentIndex, isLoading, isComplete, error, isOfflineQueue, isWeakDrill, loadQueue, loadMissedQueue, submitResult, undoLastResult, finishSession, syncPendingSessions, reset, studyStartMs, goalMinutes, leg, completeWritingLeg, completeSpeakingLeg } =
    useReviewStore()
```

(Match the exact existing destructure and append the three new names — do not drop any existing name.)

- [ ] **Step 3: Render the legs before the flashcard UI**

`study.tsx` has a series of early `return`s — `isLoading`, error, empty queue, `isSaving`, `sessionSummary` (Session Complete), and an `if (isComplete)` "Finishing up…" fallback — followed by `const currentItem = queue[currentIndex]` and the main flashcard `return`.

Immediately **after** the `if (isComplete) { ... }` fallback block and **before** `const currentItem = queue[currentIndex]`, add the leg branches:

```tsx
  // ── Loop legs — writing / speaking ───────────────────────────────────────
  // After the flashcard grade, a new or weak kanji is routed through the
  // writing and speaking legs (review.store: leg state). leg === 'flashcard'
  // falls through to the flashcard UI below.
  const legItem = queue[currentIndex]
  if (legItem && leg === 'writing') {
    return (
      <WritingLeg
        key={`writing-${legItem.kanjiId}`}
        item={legItem}
        sessionIndex={currentIndex + 1}
        sessionTotal={queue.length}
        minutesLeft={minutesLeft}
        onClose={() => router.back()}
        onComplete={completeWritingLeg}
      />
    )
  }
  if (legItem && leg === 'speaking') {
    return (
      <SpeakingLeg
        key={`speaking-${legItem.kanjiId}`}
        item={legItem}
        sessionIndex={currentIndex + 1}
        sessionTotal={queue.length}
        minutesLeft={minutesLeft}
        onClose={() => router.back()}
        onComplete={completeSpeakingLeg}
      />
    )
  }
```

`minutesLeft` is the existing variable computed in `study.tsx` (added in Plan A Task 7). `router` is the existing `useRouter()` value. The `key` forces a fresh leg component (and fresh `WritingPractice`/`VoiceEvaluator`) per kanji.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @kanji-learn/mobile typecheck`
Expected: no errors.

- [ ] **Step 5: Run the mobile test suite**

Run the mobile jest suite (from `apps/mobile`: `npx jest`).
Expected: all suites green — this task adds no tests but must not break existing ones (the 37 existing tests).

- [ ] **Step 6: Commit**

```bash
git add "apps/mobile/app/(tabs)/study.tsx"
git commit -m "$(cat <<'EOF'
feat(mobile): route the study loop through writing and speaking legs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 6: Navigation — remove the Write & Speak tabs

**Files:**
- Modify: `apps/mobile/app/(tabs)/_layout.tsx`
- Delete: `apps/mobile/app/(tabs)/writing.tsx`
- Delete: `apps/mobile/app/(tabs)/voice.tsx`

The writing and speaking practice now live inside the loop, so their standalone tabs are removed. The tab bar goes from 7 tabs to 5: **Dashboard · Study · Journal · Progress · Profile**. (Browse promotion → Plan C.) No code anywhere navigates to `/(tabs)/writing` or `/(tabs)/voice` (verified), so deletion is safe.

> **Order:** This task runs last so the loop's writing/speaking legs (Tasks 2–5) are in place before the standalone tabs disappear — the app is never left without a writing/speaking surface.

- [ ] **Step 1: Remove the two `Tabs.Screen` entries from `_layout.tsx`**

In `apps/mobile/app/(tabs)/_layout.tsx`, delete the entire `<Tabs.Screen name="writing" ... />` block and the entire `<Tabs.Screen name="voice" ... />` block:

```tsx
      <Tabs.Screen
        name="writing"
        options={{
          title: 'Write',
          tabBarIcon: ({ focused }) => <TabIcon name="pencil" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="voice"
        options={{
          title: 'Speak',
          tabBarIcon: ({ focused }) => <TabIcon name="mic" focused={focused} />,
        }}
      />
```

Leave the remaining five `Tabs.Screen` entries (`index`, `study`, `journal`, `progress`, `profile`) and everything else in the file unchanged.

- [ ] **Step 2: Delete the two tab-screen files**

```bash
git rm "apps/mobile/app/(tabs)/writing.tsx" "apps/mobile/app/(tabs)/voice.tsx"
```

(Their reusable parts — `WritingPractice`, `VoiceEvaluator`, `computeReveals`, `NotQuiteBanner`, `VoiceSuccessCard` — live under `apps/mobile/src/components/` and are untouched. The deleted files were only the standalone tab screens.)

- [ ] **Step 3: Confirm no dangling references**

Run: `grep -rn "(tabs)/writing\|(tabs)/voice\|tabs)/voice\|tabs)/writing" apps/mobile` and confirm zero hits. Also confirm nothing imports from the deleted files:
`grep -rn "app/(tabs)/writing\|app/(tabs)/voice" apps/mobile` — expect zero hits.
(The empty-queue CTAs inside the old screens used `router.push('/(tabs)/study')` — that route still exists; it is irrelevant here since the files are gone.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @kanji-learn/mobile typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/mobile/app/(tabs)/_layout.tsx"
git commit -m "$(cat <<'EOF'
feat(mobile): remove the Write & Speak tabs — practice lives in the loop

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

(`git rm` in Step 2 already staged the deletions; this commit includes them with the `_layout.tsx` edit.)

---

## Final verification

- [ ] **Typecheck both packages**

```bash
pnpm --filter @kanji-learn/mobile typecheck
pnpm --filter @kanji-learn/api typecheck
```
Expected: no new errors. `apps/api` has one pre-existing unrelated error in `test/integration/social-mute.test.ts:25` — not introduced here.

- [ ] **Run the test suites**

```bash
# from apps/mobile:
npx jest
# API (command per Task 1 Step 1):
pnpm --filter @kanji-learn/api test
```
Expected: mobile — all suites green (the 37 existing tests). API — green, including the new `planQueueSlots` cases.

- [ ] **On-device walkthrough** (next EAS build or a local dev client)
  - The tab bar shows **5** tabs: Dashboard · Study · Journal · Progress · Profile. No Write, no Speak tab.
  - Start a Study session. Grade a **new** kanji (status unseen) → after the grade it routes to the **writing** leg → "Continue to speaking" → the **speaking** leg → "Continue" / success advances to the next kanji.
  - Grade a **review** kanji **Again** or **Hard** → routes to writing → speaking.
  - Grade a **review** kanji **Good** or **Easy** → advances straight to the next kanji (no legs).
  - The time-remaining indicator shows on the writing/speaking leg headers; the session ends only after a kanji's *full* path completes, never mid-writing/mid-speaking.
  - "Drill Weak Spots" and "Drill missed cards" remain flashcard-only (no legs).
  - After a writing attempt, a row exists in `writingAttempts`; after a speaking attempt, a row exists in `voiceAttempts` (telemetry — spec §6).
  - On a heavy-review account, a Study session still surfaces some new kanji near the start (the guaranteed allowance).

---

## Notes for the executor

- **Order matters.** Task 4 (store) makes a new/weak kanji set `leg: 'writing'`; Task 5 (study.tsx) teaches the screen to render it. Run 4 then 5 with nothing in between. Task 6 (tab removal) must be last so the loop's legs exist before the standalone tabs are deleted.
- **No changes to `WritingPractice` / `VoiceEvaluator`.** Both already record their own attempts (`POST /v1/review/writing`, `POST /v1/review/voice`) — rendering them inside the loop *is* the §6 telemetry. The leg wrappers add only the "Continue" affordance.
- **`results` is still flashcard grades only.** The legs do not append to the store's `results` array; `finishSession` → `POST /v1/review/submit` is unchanged. `loadMissedQueue` / `undoLastResult` keep working.
- **Resume edge case (acceptable for v1):** `submitResult` persists the flashcard grade to `KEY_PROGRESS` at grade time. If the app is killed mid-writing/mid-speaking, resume restores `currentIndex` past that kanji — its writing/speaking legs are skipped. The flashcard SRS grade is preserved. This is a minor, acceptable v1 limitation; note it if it surfaces in review.
- **Deferred to Plan C:** the quiz leg + "maybe slipping" routing, the Browse tab, the richer vocab-word speaking layout, and the Session Complete modality breakdown.
