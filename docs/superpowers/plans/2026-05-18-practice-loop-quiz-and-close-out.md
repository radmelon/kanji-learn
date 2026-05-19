# Practice Loop — Quiz Leg & Close-Out (Plan C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out the Three-Modality Practice Loop — add the quiz leg (a "maybe slipping" review kanji is checked with a multiple-choice question; a fail counts as a lapse), promote Browse to a tab, give Speaking the richer vocab-word layout, add a Ready screen and a Session Complete modality breakdown.

**Architecture:** The study session's per-kanji `leg` state machine (Plan B: `flashcard → writing → speaking`) gains a `quiz` leg. After a Good/Easy flashcard grade, a review kanji flagged "maybe slipping" by the review-queue API is routed to a one-question multiple-choice check. A correct answer confirms the kanji and ends its path; a wrong answer downgrades the stored flashcard grade to a lapse (so the SRS resurfaces it sooner) and routes on to `writing → speaking`. The existing quiz engine (`TestService`) gains a single-kanji question generator; quiz attempts are recorded to `testSessions`/`testResults` by reusing the existing `POST /v1/tests/submit`. The standalone Browse screen moves from a modal route to a bottom tab. The Speaking leg fetches a `voicePrompt` and renders `VoiceEvaluator`'s vocab-word layout.

**Tech Stack:** React Native / Expo (TypeScript), Zustand, expo-router, Fastify + Drizzle/Postgres (API), Vitest (API), Jest (mobile).

**Plan context:** This is **Plan C of three** implementing the Three-Modality Practice Loop spec (`docs/superpowers/specs/2026-05-17-practice-loop-design.md`). Plan A (shipped) made the session time-boxed (spec §3). Plan B (shipped) added the writing/speaking loop legs and removed the Write/Speak tabs (spec §1 partial, §2 partial, §6 partial). **Plan C finishes Spec 1:** the quiz leg (§4) + the "maybe slipping" routing (§2), Browse-as-a-tab (§1), the Ready screen + Session Complete modality breakdown (§5), and the vocab-word speaking layout Plan B deferred. After Plan C, the only remaining Practice Loop spec items are none — Spec 1 is complete; Spec 1.5 (FSRS) and Spec 2 (Buddy) are separate.

---

## Scope

**In scope (Plan C)**
- **The quiz leg (spec §4).** A new `quiz` leg in the loop. A review kanji graded Good/Easy and flagged "maybe slipping" is served one multiple-choice question. Pass → confirmed, loop advances. Fail → the stored flashcard grade is downgraded to a lapse (resurfaces the card sooner) and the kanji routes on to `writing → speaking`.
- **The "maybe slipping" flag (spec §2).** The review-queue API flags a review kanji `maybeSlipping` when either: (a) it has a Hard/Again grade in its last few reviews, or (b) it is a burned card drawn into the existing ~12% surprise-check sample.
- **Single-kanji quiz generation.** `TestService` gains a method to build one question for a specific kanji; a new `GET /v1/tests/question` endpoint serves it.
- **Browse promoted to a tab (spec §1).** `app/browse.tsx` (a modal route) becomes `app/(tabs)/browse.tsx`. Tab bar 5 → 6.
- **The Ready screen (spec §5 screen 1).** The Study tab opens on a "today's plan" screen (minutes budget, due count, Begin) before the loop starts.
- **Session Complete modality breakdown (spec §5 screen 3).** Session Complete shows counts of flashcard / writing / speaking / quiz reps.
- **The vocab-word speaking layout.** The Speaking leg fetches a `voicePrompt` and renders `VoiceEvaluator`'s vocab-word layout (Plan B used the legacy kanji-reading layout).

**Out of scope (deferred)**
- **The FSRS migration** (Spec 1.5) — Plan C ships on SM-2.
- **Buddy / the AI tutor** (Spec 2) — the Journal tab is left untouched.
- **The standalone quiz screen `test.tsx`** — kept exactly as-is (a decoupled self-assessment surface reachable from the Dashboard). Plan C does not modify it; the new `QuizQuestion` component is a fresh component, not a refactor of `test.tsx`.
- **Quiz question-type selection in the loop** — the loop quiz picks a question type automatically. No mode picker.
- **Removing the orphaned `writing-queue` API endpoint** — tracked separately (a Plan B follow-up).

## Design decisions (made during planning — flag any disagreement before executing)

1. **`maybeSlipping` is an optional field on `ReviewQueueItem`.** Making it required would force every `ReviewQueueItem` producer (`getWeakKanjiQueue`, `getWritingQueue`) to set it. Optional (`maybeSlipping?: boolean`) means only `getReviewQueue` sets it; everywhere else `undefined` reads as falsy = "not flagged", which is correct (weak/missed drills are flashcard-only anyway).
2. **A failed quiz resurfaces the card by downgrading the stored flashcard grade, not via a new scheduling endpoint.** The flashcard `ReviewResult` for the kanji is already in the review store's `results[]` (appended by `submitResult`). On a quiz fail the store rewrites that result's `quality` to `1` (Again); `finishSession` → the existing `POST /v1/review/submit` then schedules it as a lapse through `calculateNextReview`. This keeps all scheduling on one path and survives the Spec 1.5 FSRS swap unchanged (a failed quiz is just another recall-failure event).
3. **Quiz telemetry reuses `POST /v1/tests/submit`.** A one-question loop quiz is a valid `TestSubmission` (`questions`/`answers` each min length 1). `saveSession` writes `testSessions` + `testResults` (spec §6) with `testType: 'loop_check'`. No new telemetry endpoint.
4. **The Speaking leg fetches its `voicePrompt` from the existing `GET /v1/review/reading-queue?kanjiIds=N` scoped path** rather than the queue API attaching a `voicePrompt` to every `ReviewQueueItem`. The reading-queue endpoint and `selectVoicePrompt` already exist and already return a per-kanji `voicePrompt`; one extra fetch in the Speaking leg is simpler than threading vocab data through the whole review queue.
5. **`QuizQuestion` is a new component, not extracted from `test.tsx`.** The scope decision keeps `test.tsx` untouched. `QuizQuestion` re-implements the multiple-choice question UI for loop use. (`test.tsx` could later be refactored to consume it — out of scope here.)
6. **The "maybe slipping" recent-history trigger looks at a kanji's last 3 reviews.** A pure, unit-tested helper (`isRecentlyShaky`) decides; the spec calls the proxy "intentionally crude" and Spec 2's Buddy replaces it.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/shared/src/types.ts` | Modify | Add optional `maybeSlipping` to `ReviewQueueItem` |
| `apps/api/src/services/srs.service.ts` | Modify | `isRecentlyShaky` helper + `RECENT_REVIEW_WINDOW`; `getReviewQueue` sets `maybeSlipping` |
| `apps/api/test/unit/recentlyShaky.test.ts` | Create | Unit tests for `isRecentlyShaky` |
| `apps/api/src/services/test.service.ts` | Modify | `generateQuestionForKanji` — one quiz question for one kanji |
| `apps/api/src/routes/test.ts` | Modify | `GET /v1/tests/question?kanjiId=N` |
| `apps/mobile/src/components/study/QuizQuestion.tsx` | Create | One multiple-choice question — prompt card + options |
| `apps/mobile/src/components/study/QuizLeg.tsx` | Create | Quiz leg — wraps `QuizQuestion` for one kanji |
| `apps/mobile/src/stores/review.store.ts` | Modify | `quiz` leg + routing; `passQuizLeg`/`failQuizLeg`; `modalityCounts` |
| `apps/mobile/app/(tabs)/study.tsx` | Modify | Render the quiz leg; Ready-screen phase; pass modality counts |
| `apps/mobile/src/components/study/SpeakingLeg.tsx` | Modify | Fetch `voicePrompt`; render the vocab-word layout |
| `apps/mobile/src/components/study/SessionComplete.tsx` | Modify | Modality breakdown row |
| `apps/mobile/src/components/study/ReadyScreen.tsx` | Create | "Today's plan" pre-loop screen |
| `apps/mobile/app/(tabs)/browse.tsx` | Create (git mv) | Browse as a tab screen |
| `apps/mobile/app/browse.tsx` | Delete (git mv) | Old modal Browse route |
| `apps/mobile/app/(tabs)/_layout.tsx` | Modify | Add the Browse `Tabs.Screen` |
| `apps/mobile/app/_layout.tsx` | Modify | Remove the Browse modal `Stack.Screen` |
| `apps/mobile/app/(tabs)/progress.tsx` | Modify | Remove the now-redundant Browse button |

---

## Task 1: API — the "maybe slipping" flag

**Files:**
- Modify: `packages/shared/src/types.ts`
- Create: `apps/api/test/unit/recentlyShaky.test.ts`
- Modify: `apps/api/src/services/srs.service.ts`

`getReviewQueue` returns three tiers: due reviews, new kanji, and a ~12% sample of burned cards. Plan C flags review kanji as `maybeSlipping` so the loop can route a Good/Easy-graded one to a quiz. Two triggers: (a) a Hard/Again grade in the kanji's last few reviews — a new unit-tested helper, (b) the kanji is a burned-sample card — always true for that tier.

- [ ] **Step 1: Add `maybeSlipping` to `ReviewQueueItem`**

In `packages/shared/src/types.ts`, the `ReviewQueueItem` interface currently ends with `morohashiPage: number | null`. Add a final field:

```ts
export interface ReviewQueueItem extends ReviewItem {
  jlptLevel: string
  meanings: string[]
  kunReadings: string[]
  onReadings: string[]
  exampleVocab: { word: string; reading: string; meaning: string }[]
  exampleSentences: { ja: string; en: string; vocab: string }[]
  status: string
  readingStage: number
  strokeCount: number
  radicals: string[]
  nelsonClassic: number | null
  nelsonNew: number | null
  morohashiIndex: number | null
  morohashiVolume: number | null
  morohashiPage: number | null
  /** True when the loop should route this kanji to a quiz check on a Good/Easy
   *  grade (Practice Loop spec §2). Optional — set only by getReviewQueue;
   *  absent (falsy) on every other queue. */
  maybeSlipping?: boolean
}
```

- [ ] **Step 2: Write the failing unit test**

Create `apps/api/test/unit/recentlyShaky.test.ts`. The API test suite uses **vitest** (imports `{ describe, it, expect } from 'vitest'`). Match that style:

```ts
import { describe, it, expect } from 'vitest'
import { isRecentlyShaky } from '../../src/services/srs.service'

describe('isRecentlyShaky', () => {
  it('flags a kanji with an Again grade in its last 3 reviews', () => {
    expect(isRecentlyShaky([4, 1, 5])).toBe(true)
  })
  it('flags a kanji with a Hard grade in its last 3 reviews', () => {
    expect(isRecentlyShaky([3, 4, 5])).toBe(true)
  })
  it('does not flag a kanji with only Good/Easy in its last 3 reviews', () => {
    expect(isRecentlyShaky([4, 5, 4])).toBe(false)
  })
  it('ignores a Hard grade older than the 3-review window', () => {
    expect(isRecentlyShaky([4, 5, 4, 3])).toBe(false)
  })
  it('returns false for a kanji with no review history', () => {
    expect(isRecentlyShaky([])).toBe(false)
  })
  it('treats legacy quality 0 and 2 as shaky', () => {
    expect(isRecentlyShaky([0])).toBe(true)
    expect(isRecentlyShaky([2])).toBe(true)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @kanji-learn/api test -- recentlyShaky`
Expected: FAIL — `isRecentlyShaky` is not exported.

- [ ] **Step 4: Implement `isRecentlyShaky`**

In `apps/api/src/services/srs.service.ts`, add this exported constant and function at module scope, directly after the `planQueueSlots` function (which ends around line 90, before `export class SrsService`):

```ts
/** How many of a kanji's most recent reviews the "recently shaky" check looks at. */
export const RECENT_REVIEW_WINDOW = 3

/**
 * True when a kanji is "recently shaky" — it has a Hard (quality 3) or Again
 * (quality 0–2) grade among its most recent reviews. One of the two "maybe
 * slipping" triggers (Practice Loop spec §2): despite a Good/Easy self-grade
 * today, a recently-shaky review kanji is routed to a quiz check.
 *
 * @param recentGrades the kanji's review grades, MOST RECENT FIRST.
 */
export function isRecentlyShaky(recentGrades: number[]): boolean {
  return recentGrades.slice(0, RECENT_REVIEW_WINDOW).some((q) => q <= 3)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @kanji-learn/api test -- recentlyShaky`
Expected: PASS — all six cases green.

- [ ] **Step 6: Wire `maybeSlipping` into `getReviewQueue`**

In `getReviewQueue` (same file), the body computes `dueRows` / `guaranteedNewRows` / `fillNewRows` via `planQueueSlots`, then queries `burnedChecks`, then defines `mapDue` / `mapNew` / `mapBurned`. Make three edits.

**(a)** Immediately after the line `const fillNewRows = newCardRows.slice(slots.guaranteedNew, slots.guaranteedNew + slots.fillNew)`, insert the recent-history query:

```ts
    // "Maybe slipping" trigger (a): a due review kanji with a Hard/Again grade
    // in its last few reviews. Burned-check cards are trigger (b) — flagged
    // unconditionally in mapBurned below. (Practice Loop spec §2.)
    const dueKanjiIds = dueRows.map((c) => c.kanjiId)
    const recentLogs = dueKanjiIds.length > 0
      ? await this.db
          .select({ kanjiId: reviewLogs.kanjiId, quality: reviewLogs.quality })
          .from(reviewLogs)
          .where(and(eq(reviewLogs.userId, userId), inArray(reviewLogs.kanjiId, dueKanjiIds)))
          .orderBy(desc(reviewLogs.reviewedAt))
      : []
    const gradesByKanji = new Map<number, number[]>()
    for (const log of recentLogs) {
      const arr = gradesByKanji.get(log.kanjiId) ?? []
      arr.push(log.quality)
      gradesByKanji.set(log.kanjiId, arr)
    }
    const shakyKanji = new Set<number>()
    for (const [kid, grades] of gradesByKanji) {
      if (isRecentlyShaky(grades)) shakyKanji.add(kid)
    }
```

(`reviewLogs`, `and`, `eq`, `inArray`, `desc` are all already imported in `srs.service.ts` — no import changes needed.)

**(b)** In the `mapDue` arrow function, add a `maybeSlipping` field. `mapDue` currently returns `{ ...c, status, readingStage, reviewType, meanings, kunReadings, onReadings, radicals, exampleVocab, exampleSentences }`. Add one line so it becomes:

```ts
    const mapDue = (c: (typeof dueCards)[number]) => ({
      ...c,
      status: c.status ?? 'learning',
      readingStage: c.readingStage ?? 0,
      reviewType: this.pickReviewType(c.readingStage ?? 0, c.status ?? 'learning'),
      maybeSlipping: shakyKanji.has(c.kanjiId),
      meanings: toArr<string>(c.meanings),
      kunReadings: toArr<string>(c.kunReadings),
      onReadings: toArr<string>(c.onReadings),
      radicals: toArr<string>(c.radicals),
      exampleVocab: toArr<{ word: string; reading: string; meaning: string }>(c.exampleVocab),
      exampleSentences: toArr<{ ja: string; en: string; vocab: string }>(c.exampleSentences),
    })
```

**(c)** In the `mapBurned` arrow function, add `maybeSlipping: true` (a burned-sample card is trigger (b)). It becomes:

```ts
    const mapBurned = (c: (typeof burnedChecks)[number]) => ({
      ...c,
      status: c.status ?? 'burned',
      readingStage: c.readingStage ?? 4,
      reviewType: this.pickReviewType(c.readingStage ?? 4, 'burned'),
      maybeSlipping: true,
      meanings: toArr<string>(c.meanings),
      kunReadings: toArr<string>(c.kunReadings),
      onReadings: toArr<string>(c.onReadings),
      radicals: toArr<string>(c.radicals),
      exampleVocab: toArr<{ word: string; reading: string; meaning: string }>(c.exampleVocab),
      exampleSentences: toArr<{ ja: string; en: string; vocab: string }>(c.exampleSentences),
    })
```

Leave `mapNew` unchanged — new kanji always route through `writing → speaking`, so `maybeSlipping` is irrelevant for them (it stays `undefined`, which reads as falsy).

- [ ] **Step 7: Typecheck the API**

Run: `pnpm --filter @kanji-learn/api typecheck`
Expected: no **new** errors. (`apps/api` has one pre-existing unrelated error at `test/integration/social-mute.test.ts:25` — leave it.) Because `maybeSlipping` is **optional**, `getWeakKanjiQueue` and `getWritingQueue` need no change — they simply don't set it.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/types.ts apps/api/src/services/srs.service.ts apps/api/test/unit/recentlyShaky.test.ts
git commit -m "$(cat <<'EOF'
feat(api): flag maybe-slipping review kanji in the review queue

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 2: API — single-kanji quiz question

**Files:**
- Modify: `apps/api/src/services/test.service.ts`
- Modify: `apps/api/src/routes/test.ts`

`TestService.generateQuestions` builds questions from a random global pool. The loop quiz needs one question for one specific kanji. `buildQuestion` already builds for a single kanji given a distractor pool; this task adds a public method that targets a kanji id, and a route to serve it.

- [ ] **Step 1: Add `generateQuestionForKanji` to `TestService`**

In `apps/api/src/services/test.service.ts`, inside the `TestService` class, add this method directly after `generateQuestions` (and before the `private buildQuestion` method):

```ts
  /**
   * Build a single quiz question for one specific kanji — used by the Practice
   * Loop's quiz leg. Distractors are drawn from the user's other seen kanji.
   * Returns null when no question can be built (fewer than 4 seen kanji, so
   * there aren't enough distractors; or the target kanji is not yet seen).
   */
  async generateQuestionForKanji(userId: string, kanjiId: number): Promise<TestQuestion | null> {
    // The seen pool — the target plus distractor candidates.
    const seen = await this.db
      .select({
        kanjiId: userKanjiProgress.kanjiId,
        character: kanji.character,
        jlptLevel: kanji.jlptLevel,
        meanings: kanji.meanings,
        kunReadings: kanji.kunReadings,
        onReadings: kanji.onReadings,
        exampleVocab: kanji.exampleVocab,
      })
      .from(userKanjiProgress)
      .innerJoin(kanji, eq(userKanjiProgress.kanjiId, kanji.id))
      .where(
        and(
          eq(userKanjiProgress.userId, userId),
          ne(userKanjiProgress.status, 'unseen')
        )
      )

    if (seen.length < 4) return null

    const target = seen.find((k) => k.kanjiId === kanjiId)
    if (!target) return null

    // Try each question type in random order until one builds — some types
    // need vocab or readings the kanji may not have.
    const allTypes: QuestionType[] = [
      'meaning_recall', 'reading_recall', 'kanji_from_meaning',
      'vocab_reading', 'vocab_from_definition',
    ]
    for (let i = allTypes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[allTypes[i], allTypes[j]] = [allTypes[j]!, allTypes[i]!]
    }
    for (const type of allTypes) {
      const q = this.buildQuestion(target, seen, type)
      if (q) return q
    }
    return null
  }
```

(`and`, `eq`, `ne` are already imported in `test.service.ts` via `import { and, eq, ne, sql, desc } from 'drizzle-orm'` — no import change.)

- [ ] **Step 2: Add the `GET /v1/tests/question` route**

In `apps/api/src/routes/test.ts`, inside `testRoutes`, add this handler directly after the `GET /questions` handler (before `GET /analytics`):

```ts
  // GET /v1/tests/question?kanjiId=123 — a single quiz question for one kanji
  // (the Practice Loop quiz leg). `data` is null when no question can be built.
  server.get<{ Querystring: { kanjiId?: string } }>(
    '/question',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const kanjiId = Number(req.query.kanjiId)
      if (!Number.isInteger(kanjiId) || kanjiId <= 0) {
        return reply.code(400).send({ ok: false, error: 'kanjiId required', code: 'VALIDATION_ERROR' })
      }
      const question = await testService.generateQuestionForKanji(req.userId!, kanjiId)
      return reply.send({ ok: true, data: question })
    }
  )
```

- [ ] **Step 3: Typecheck the API**

Run: `pnpm --filter @kanji-learn/api typecheck`
Expected: no new errors (the one pre-existing `social-mute.test.ts:25` error aside).

- [ ] **Step 4: Run the API test suite**

Run: `pnpm --filter @kanji-learn/api test`
Expected: the unit suites stay green (including `recentlyShaky` from Task 1). Integration tests that hit a real Postgres DB may fail on environment/DB-state issues — those are not regressions from this task; the unit suites are what must pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/test.service.ts apps/api/src/routes/test.ts
git commit -m "$(cat <<'EOF'
feat(api): add single-kanji quiz question generation for the loop

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 3: QuizQuestion component

**Files:**
- Create: `apps/mobile/src/components/study/QuizQuestion.tsx`

A presentational component rendering one multiple-choice question — the prompt card plus four options with correct/incorrect feedback styling. The quiz leg (Task 4) consumes it. This is a fresh component; `test.tsx` is intentionally left untouched.

- [ ] **Step 1: Create `QuizQuestion.tsx`**

Create `apps/mobile/src/components/study/QuizQuestion.tsx`:

```tsx
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import type { TestQuestion, QuestionType } from '@kanji-learn/shared'
import { colors, spacing, radius, typography } from '../../theme'

const JLPT_COLORS: Record<string, string> = {
  N5: colors.n5, N4: colors.n4, N3: colors.n3, N2: colors.n2, N1: colors.n1,
}

const PROMPT_LABELS: Record<QuestionType, string> = {
  meaning_recall: 'What does this kanji mean?',
  kanji_from_meaning: 'Which kanji matches this meaning?',
  reading_recall: 'How do you read this kanji?',
  vocab_reading: 'How do you read this word?',
  vocab_from_definition: 'Which word means this?',
}

/** A kanji-character prompt is shown large; a text prompt is shown as a heading. */
const isCharacterPrompt = (qt: QuestionType) => qt === 'meaning_recall' || qt === 'reading_recall'
/** Options that are kanji characters render large and centred. */
const isCharacterOptions = (qt: QuestionType) => qt === 'kanji_from_meaning'

interface Props {
  question: TestQuestion
  /** The option index the user picked, or null before they answer. */
  selectedIndex: number | null
  /** When true, options show correct/incorrect colouring and are disabled. */
  showFeedback: boolean
  onSelect: (index: number) => void
}

/**
 * One multiple-choice quiz question — the prompt card plus four options with
 * correct/incorrect feedback styling. Reused by the Practice Loop's quiz leg.
 */
export function QuizQuestion({ question, selectedIndex, showFeedback, onSelect }: Props) {
  const jlptColor = JLPT_COLORS[question.jlptLevel] ?? colors.textMuted
  const charOpts = isCharacterOptions(question.questionType)

  return (
    <View style={styles.wrap}>
      <View style={styles.kanjiCard}>
        <View style={[styles.jlptBadge, { backgroundColor: jlptColor + '22', borderColor: jlptColor + '55' }]}>
          <Text style={[styles.jlptText, { color: jlptColor }]}>{question.jlptLevel}</Text>
        </View>
        {isCharacterPrompt(question.questionType) ? (
          <Text style={styles.kanjiCharacter}>{question.prompt}</Text>
        ) : (
          <Text style={styles.textPrompt}>{question.prompt}</Text>
        )}
        <Text style={styles.promptLabel}>{PROMPT_LABELS[question.questionType]}</Text>
      </View>

      <View style={styles.optionsArea}>
        {question.options.map((option, idx) => {
          const isSelected = selectedIndex === idx
          const isCorrect = idx === question.correctIndex
          let optionStyle = {}
          let textStyle = {}
          let iconName: 'checkmark-circle' | 'close-circle' | null = null
          let iconColor: string = colors.textMuted

          if (showFeedback) {
            if (isCorrect) {
              optionStyle = { backgroundColor: colors.success + '22', borderColor: colors.success }
              textStyle = { color: colors.success }
              iconName = 'checkmark-circle'
              iconColor = colors.success
            } else if (isSelected && !isCorrect) {
              optionStyle = { backgroundColor: colors.error + '22', borderColor: colors.error }
              textStyle = { color: colors.error }
              iconName = 'close-circle'
              iconColor = colors.error
            } else {
              optionStyle = { opacity: 0.4 }
            }
          }

          return (
            <TouchableOpacity
              key={idx}
              style={[styles.optionButton, charOpts && styles.optionButtonChar, optionStyle]}
              onPress={() => onSelect(idx)}
              activeOpacity={0.8}
              disabled={showFeedback}
            >
              <Text style={[charOpts ? styles.optionCharText : styles.optionText, textStyle]}>{option}</Text>
              {showFeedback && iconName && !charOpts && (
                <Ionicons name={iconName} size={20} color={iconColor} />
              )}
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg },
  kanjiCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
    position: 'relative',
  },
  jlptBadge: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  jlptText: { ...typography.caption, fontWeight: '700' },
  kanjiCharacter: { ...typography.kanjiDisplay, color: colors.textPrimary, marginTop: spacing.md },
  textPrompt: {
    ...typography.h2,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  promptLabel: { ...typography.bodySmall, color: colors.textMuted, marginTop: spacing.xs },
  optionsArea: { gap: spacing.sm },
  optionButton: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionButtonChar: { justifyContent: 'center', paddingVertical: spacing.lg },
  optionText: { ...typography.body, color: colors.textPrimary, flex: 1 },
  optionCharText: { fontSize: 32, lineHeight: 40, color: colors.textPrimary, textAlign: 'center' },
})
```

- [ ] **Step 2: Verify the imports resolve**

Confirm `TestQuestion` and `QuestionType` are exported from `@kanji-learn/shared` (they are — in `packages/shared/src/types.ts`), and that the theme exports the keys used (`colors.n5`–`n1`, `colors.bgCard`, `colors.bgSurface`, `colors.border`, `colors.success`, `colors.error`, `colors.textPrimary`, `colors.textMuted`, `typography.kanjiDisplay`, `typography.h2`, `typography.body`, `typography.bodySmall`, `typography.caption`, `spacing.*`, `radius.full`/`lg`). If `typography.kanjiDisplay` does not exist, use the closest large-text style and report the deviation.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @kanji-learn/mobile typecheck`
Expected: no errors. (`QuizQuestion` is unused until Task 4 — an unused export does not error.)

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/study/QuizQuestion.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): add QuizQuestion — a reusable multiple-choice question

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 4: QuizLeg component

**Files:**
- Create: `apps/mobile/src/components/study/QuizLeg.tsx`

The quiz leg serves one question for a "maybe slipping" kanji. It fetches the question (`GET /v1/tests/question`), renders `QuizQuestion`, shows feedback for 1.2 s, records the attempt to `testSessions`/`testResults` via `POST /v1/tests/submit`, then calls `onComplete(passed)`. It follows the same `Props` shape as `WritingLeg`/`SpeakingLeg`, except `onComplete` carries the pass/fail result.

- [ ] **Step 1: Create `QuizLeg.tsx`**

Create `apps/mobile/src/components/study/QuizLeg.tsx`:

```tsx
import { useState, useEffect, useRef, useCallback } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import type { ReviewQueueItem, TestQuestion } from '@kanji-learn/shared'
import { api } from '../../lib/api'
import { QuizQuestion } from './QuizQuestion'
import { colors, spacing, radius, typography } from '../../theme'

interface Props {
  item: ReviewQueueItem
  /** 1-based position of this kanji in the session queue (display only). */
  sessionIndex: number
  sessionTotal: number
  minutesLeft: number | null
  onClose: () => void
  /** Called when the quiz leg is done. `passed` false routes the loop on to
   *  writing → speaking and resurfaces the card sooner (spec §4). */
  onComplete: (passed: boolean) => void
}

const FEEDBACK_MS = 1200

/**
 * The quiz leg of the Practice Loop. Serves one multiple-choice question for a
 * "maybe slipping" review kanji. A correct answer confirms the kanji; a wrong
 * answer is treated as a lapse (spec §4). The attempt is recorded to
 * testSessions/testResults via POST /v1/tests/submit (telemetry — spec §6).
 */
export function QuizLeg({ item, sessionIndex, sessionTotal, minutesLeft, onClose, onComplete }: Props) {
  const [question, setQuestion] = useState<TestQuestion | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [showFeedback, setShowFeedback] = useState(false)
  const startMs = useRef(Date.now())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // onComplete via ref so the fetch/timeout callbacks never read a stale closure.
  const onCompleteRef = useRef(onComplete)
  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  // Fetch a single quiz question for this kanji on mount.
  useEffect(() => {
    let cancelled = false
    api.get<TestQuestion | null>(`/v1/tests/question?kanjiId=${item.kanjiId}`)
      .then((q) => {
        if (cancelled) return
        // No question could be built (too few seen kanji for distractors).
        // Skip the check rather than blocking the loop — treat as a pass.
        if (!q) { onCompleteRef.current(true); return }
        setQuestion(q)
        startMs.current = Date.now()
      })
      .catch(() => { if (!cancelled) setLoadFailed(true) })
    return () => { cancelled = true }
  }, [item.kanjiId])

  const handleSelect = useCallback((index: number) => {
    if (showFeedback || !question) return
    const responseMs = Date.now() - startMs.current
    const passed = index === question.correctIndex
    setSelectedIndex(index)
    setShowFeedback(true)

    // Record the attempt for telemetry (spec §6). Fire-and-forget — a failed
    // POST must not block the loop.
    api.post('/v1/tests/submit', {
      testType: 'loop_check',
      questions: [question],
      answers: [{ kanjiId: item.kanjiId, selectedIndex: index, responseMs }],
    }).catch(() => {})

    timerRef.current = setTimeout(() => onCompleteRef.current(passed), FEEDBACK_MS)
  }, [showFeedback, question, item.kanjiId])

  // ── Question fetch failed (offline?) — don't strand the user; let them skip.
  if (loadFailed) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.centered}>
          <Text style={styles.skipText}>Couldn't load a quiz question.</Text>
          <TouchableOpacity style={styles.skipBtn} onPress={() => onComplete(true)} activeOpacity={0.85}>
            <Text style={styles.skipBtnText}>Continue</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // ── Loading the question.
  if (!question) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Ionicons name="close" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.legLabel}>Quick check</Text>
        <Text style={styles.counter}>{sessionIndex}/{sessionTotal}</Text>
        {minutesLeft !== null && (
          <Text style={styles.timeLeft}>{minutesLeft}m left</Text>
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <QuizQuestion
          question={question}
          selectedIndex={selectedIndex}
          showFeedback={showFeedback}
          onSelect={handleSelect}
        />
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
  scrollContent: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xxl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.xl },
  skipText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  skipBtn: {
    backgroundColor: colors.primary, borderRadius: radius.lg,
    paddingVertical: spacing.md, paddingHorizontal: spacing.xl,
  },
  skipBtnText: { ...typography.h3, color: '#fff' },
})
```

- [ ] **Step 2: Verify the API path**

Confirm `api.get` / `api.post` are exported from `apps/mobile/src/lib/api` and unwrap the `{ ok, data }` envelope (they do — every other screen uses `api.get<T>` and receives `data` directly). `GET /v1/tests/question` returns `{ ok: true, data: TestQuestion | null }`, so `api.get<TestQuestion | null>` yields `TestQuestion | null`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @kanji-learn/mobile typecheck`
Expected: no errors. (`QuizLeg` is unused until Task 6.)

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/study/QuizLeg.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): add QuizLeg — the loop's quiz check leg

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 5: Review store — quiz leg routing & modality counts

**Files:**
- Modify: `apps/mobile/src/stores/review.store.ts`

The store's `leg` state machine gains a `quiz` leg. `submitResult` routes a Good/Easy `maybeSlipping` review kanji to it. `passQuizLeg` ends the kanji; `failQuizLeg` downgrades the stored flashcard grade to a lapse and routes on to `writing`. The store also tracks per-modality rep counts for the Session Complete breakdown.

> **Sequencing note:** This task makes `submitResult` set `leg: 'quiz'` for some kanji, and adds `passQuizLeg`/`failQuizLeg`. Until Task 6 teaches `study.tsx` to render the quiz leg, the app is transiently incomplete (a slipping kanji would leave the flashcard on screen). Task 6 must follow immediately.

- [ ] **Step 1: Add `'quiz'` to `LegName` and a `ModalityCounts` type**

In `apps/mobile/src/stores/review.store.ts`, the `LegName` type currently reads `export type LegName = 'flashcard' | 'writing' | 'speaking'`. Change it and add a new type directly below:

```ts
/** The current kanji's position within the Practice Loop. */
export type LegName = 'flashcard' | 'writing' | 'speaking' | 'quiz'

/** Per-modality rep counts for the current session — shown on Session Complete. */
export interface ModalityCounts {
  flashcard: number
  writing: number
  speaking: number
  quiz: number
}
```

- [ ] **Step 2: Add `modalityCounts` + the two quiz actions to the interface**

In `interface ReviewState`, after the `leg: LegName` field, add the `modalityCounts` field; and after the existing `completeSpeakingLeg` signature, add the two new action signatures:

```ts
  /** The current kanji's leg in the loop. New + Again/Hard kanji run flashcard
   *  → writing → speaking; Good/Easy review kanji stay on 'flashcard' unless
   *  flagged 'maybe slipping', which routes them to 'quiz'. */
  leg: LegName
  /** Per-modality rep counts for the current session (Session Complete §5). */
  modalityCounts: ModalityCounts
```

```ts
  /** Writing leg finished → move to the speaking leg. */
  completeWritingLeg: () => void
  /** Speaking leg finished → advance to the next kanji. */
  completeSpeakingLeg: () => void
  /** Quiz passed → the kanji is confirmed; advance to the next kanji. */
  passQuizLeg: () => void
  /** Quiz failed → downgrade the flashcard grade to a lapse and route to writing. */
  failQuizLeg: () => void
```

(Show only for placement context — the surrounding lines are unchanged.)

- [ ] **Step 3: Initialise `modalityCounts` in the store body**

In the `create<ReviewState>` initial state, after `leg: 'flashcard',` add:

```ts
  leg: 'flashcard',
  modalityCounts: { flashcard: 0, writing: 0, speaking: 0, quiz: 0 },
```

- [ ] **Step 4: Reset `modalityCounts` in every queue-load and reset path**

Add `modalityCounts: { flashcard: 0, writing: 0, speaking: 0, quiz: 0 }` alongside the existing `leg: 'flashcard'` in four `set(...)` calls:

- In `loadQueue`, the **first** `set(...)` call (the one with `isLoading: true, isComplete: false, currentIndex: 0, results: [], ..., leg: 'flashcard'`).
- In `loadWeakQueue`, the `set(...)` with `isWeakDrill: true` and `goalMinutes: 0`.
- In `loadMissedQueue`, the `set(...)` that sets `queue: missedCards, ...`.
- In `reset`, the `set(...)`.

(The `loadWeakQueue` *first* `set` and `undoLastResult`'s `set` reset `leg` but **not** `modalityCounts` — see the note in Step 6.)

- [ ] **Step 5: Rewrite `submitResult` and the leg actions**

Replace the entire `submitResult` function, and the `completeWritingLeg` / `completeSpeakingLeg` lines, with the version below — and add `passQuizLeg` / `failQuizLeg` after them. (`endKanji` and `undoLastResult` are unchanged.)

```ts
  submitResult: (result) => {
    const { results, queue, currentIndex, studyStartMs, modalityCounts } = get()
    const newResults = [...results, result]
    const item = queue[currentIndex]

    // The flashcard grade is final at grade time — record + persist it now,
    // and count the flashcard rep.
    set({
      results: newResults,
      modalityCounts: { ...modalityCounts, flashcard: modalityCounts.flashcard + 1 },
    })
    storage.setItem(KEY_PROGRESS, { userId: 'current', results: newResults, studyStartMs })

    // Per-kanji loop routing — main loop only (weak/missed drills have
    // goalMinutes 0 and stay flashcard-only).
    //   • A new kanji, or an Again(1)/Hard(3) review kanji → writing → speaking.
    //   • A Good/Easy review kanji flagged "maybe slipping" → quiz.
    //   • A Good/Easy review kanji not flagged → done.
    const { goalMinutes } = get()
    const isNew = item?.status === 'unseen'
    const isWeak = result.quality === 1 || result.quality === 3

    if (goalMinutes > 0 && (isNew || isWeak)) {
      set({ leg: 'writing' })
    } else if (goalMinutes > 0 && item?.maybeSlipping) {
      set({ leg: 'quiz' })
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
    // cuts off mid-leg.
    const overBudget =
      goalMinutes > 0 && Date.now() - studyStartMs >= goalMinutes * 60_000

    set({
      currentIndex: nextIndex,
      isComplete: nextIndex >= queue.length || overBudget,
      leg: 'flashcard',
    })
  },

  completeWritingLeg: () => {
    const { modalityCounts } = get()
    set({ leg: 'speaking', modalityCounts: { ...modalityCounts, writing: modalityCounts.writing + 1 } })
  },

  completeSpeakingLeg: () => {
    const { modalityCounts } = get()
    set({ modalityCounts: { ...modalityCounts, speaking: modalityCounts.speaking + 1 } })
    get().endKanji()
  },

  passQuizLeg: () => {
    const { modalityCounts } = get()
    set({ modalityCounts: { ...modalityCounts, quiz: modalityCounts.quiz + 1 } })
    get().endKanji()
  },

  failQuizLeg: () => {
    const { results, studyStartMs, modalityCounts } = get()
    // A failed quiz is a genuine lapse (spec §4). The flashcard result for
    // this kanji is the last one submitResult appended — rewrite its grade to
    // Again (1) so finishSession → POST /v1/review/submit reschedules the card
    // sooner. The quiz attempt itself is recorded to testSessions separately
    // by QuizLeg via POST /v1/tests/submit.
    const downgraded = results.length > 0
      ? [...results.slice(0, -1), { ...results[results.length - 1]!, quality: 1 as const }]
      : results
    set({
      results: downgraded,
      leg: 'writing',
      modalityCounts: { ...modalityCounts, quiz: modalityCounts.quiz + 1 },
    })
    storage.setItem(KEY_PROGRESS, { userId: 'current', results: downgraded, studyStartMs })
  },
```

(The `endKanji` body above is **unchanged** from its current form — shown only because it sits between the rewritten functions. Do not alter it.)

- [ ] **Step 6: Confirm `undoLastResult` is left as-is**

`undoLastResult` already resets `leg: 'flashcard'`, which is correct for the new `'quiz'` leg too (it can only be invoked from a later kanji's flashcard). It does **not** adjust `modalityCounts` — a rare, acceptable v1 imprecision (undoing rewinds a flashcard grade but leaves the rep count; undo is only reachable before any leg runs). Leave `undoLastResult` unchanged.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @kanji-learn/mobile typecheck`
Expected: NO errors. `study.tsx` calls `submitResult` (signature unchanged) and does not yet use `passQuizLeg`/`failQuizLeg`/`modalityCounts` — those are wired in Tasks 6 and 8.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/stores/review.store.ts
git commit -m "$(cat <<'EOF'
feat(mobile): add the quiz leg + modality counts to the review store

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 6: study.tsx — render the quiz leg

**Files:**
- Modify: `apps/mobile/app/(tabs)/study.tsx`

`study.tsx` renders the quiz leg when the store's `leg === 'quiz'`, alongside the existing writing/speaking branches.

- [ ] **Step 1: Import `QuizLeg`**

Near the existing `WritingLeg` / `SpeakingLeg` imports in `study.tsx`, add:

```ts
import { QuizLeg } from '../../src/components/study/QuizLeg'
```

- [ ] **Step 2: Pull the quiz actions from the store**

`study.tsx` has one `useReviewStore()` destructure. It currently ends `..., leg, completeWritingLeg, completeSpeakingLeg } = useReviewStore()`. Append `passQuizLeg` and `completeSpeakingLeg`'s sibling `failQuizLeg`:

```ts
  const { queue, currentIndex, isLoading, isComplete, error, isOfflineQueue, isWeakDrill, loadQueue, loadMissedQueue, submitResult, undoLastResult, finishSession, syncPendingSessions, reset, studyStartMs, goalMinutes, leg, completeWritingLeg, completeSpeakingLeg, passQuizLeg, failQuizLeg } =
    useReviewStore()
```

(Match the exact existing destructure and append the two new names — do not drop any existing name.)

- [ ] **Step 3: Render the quiz leg**

`study.tsx` has the writing/speaking leg branches (`if (legItem && leg === 'writing')` … `if (legItem && leg === 'speaking')`) immediately before `const currentItem = queue[currentIndex]`. Add a third branch directly after the speaking branch and before `const currentItem = …`:

```tsx
  if (legItem && leg === 'quiz') {
    return (
      <QuizLeg
        key={`quiz-${legItem.kanjiId}`}
        item={legItem}
        sessionIndex={currentIndex + 1}
        sessionTotal={queue.length}
        minutesLeft={minutesLeft}
        onClose={() => router.back()}
        onComplete={(passed) => (passed ? passQuizLeg() : failQuizLeg())}
      />
    )
  }
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @kanji-learn/mobile typecheck`
Expected: no errors.

- [ ] **Step 5: Run the mobile test suite**

From `apps/mobile`: `npx jest`
Expected: all suites green (the 37 existing tests). This task adds no tests but must not break existing ones.

- [ ] **Step 6: Commit**

```bash
git add "apps/mobile/app/(tabs)/study.tsx"
git commit -m "$(cat <<'EOF'
feat(mobile): route the study loop through the quiz leg

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 7: SpeakingLeg — the vocab-word layout

**Files:**
- Modify: `apps/mobile/src/components/study/SpeakingLeg.tsx`

Plan B's `SpeakingLeg` renders `VoiceEvaluator`'s legacy kanji-reading layout (no `voicePrompt`). This task fetches a `voicePrompt` for the kanji from the existing `GET /v1/review/reading-queue?kanjiIds=N` scoped path and passes it to `VoiceEvaluator`, which then renders the richer vocab-word layout when the kanji has example vocab.

- [ ] **Step 1: Rewrite `SpeakingLeg.tsx`**

Replace the entire contents of `apps/mobile/src/components/study/SpeakingLeg.tsx` with:

```tsx
import { useState, useEffect, useCallback } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import type { ReviewQueueItem, VoicePrompt } from '@kanji-learn/shared'
import { api } from '../../lib/api'
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
 * The voicePrompt is fetched on mount from GET /v1/review/reading-queue: when
 * the kanji has example vocab, VoiceEvaluator renders its richer vocab-word
 * layout; otherwise it falls back to the legacy kanji-reading layout.
 */
export function SpeakingLeg({ item, sessionIndex, sessionTotal, minutesLeft, onClose, onComplete }: Props) {
  const [voicePrompt, setVoicePrompt] = useState<VoicePrompt | null>(null)
  const [attempts, setAttempts] = useState(0)
  const [evaluated, setEvaluated] = useState(false)
  const [lastResult, setLastResult] = useState<EvalResult | null>(null)
  const [showInterstitial, setShowInterstitial] = useState(false)

  // Fetch the voicePrompt for this kanji on mount. The scoped reading-queue
  // path returns one row per kanjiId, each with a `voicePrompt`. On any failure
  // fall back to { type: 'kanji' } — the legacy kanji-reading layout.
  useEffect(() => {
    let cancelled = false
    api.get<{ voicePrompt: VoicePrompt }[]>(`/v1/review/reading-queue?kanjiIds=${item.kanjiId}`)
      .then((rows) => { if (!cancelled) setVoicePrompt(rows[0]?.voicePrompt ?? { type: 'kanji' }) })
      .catch(() => { if (!cancelled) setVoicePrompt({ type: 'kanji' }) })
    return () => { cancelled = true }
  }, [item.kanjiId])

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
  const isVocab = voicePrompt?.type === 'vocab'

  // ── Loading the voicePrompt.
  if (voicePrompt === null) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </SafeAreaView>
    )
  }

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

        {/* Reading chips — revealed from try 2 onward (kanji-layout hint). */}
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
            word={isVocab ? voicePrompt.word : item.character}
            reading={isVocab ? voicePrompt.reading : (item.kunReadings[0] ?? item.onReadings[0] ?? '')}
            targetKanji={isVocab ? voicePrompt.targetKanji : item.character}
            kanjiMeaning={item.meanings.slice(0, 3).join(', ')}
            vocabMeaning={isVocab ? voicePrompt.meaning : ''}
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
              voicePrompt={voicePrompt}
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
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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

What changed from Plan B's `SpeakingLeg`: a `voicePrompt` state + a mount-time fetch; a loading branch while it resolves; `voicePrompt={voicePrompt}` passed to `VoiceEvaluator` (it renders the vocab layout when `voicePrompt.type === 'vocab'`); and `VoiceSuccessCard` fed the vocab word/reading/meaning/targetKanji when in vocab mode. The progressive-hint ladder, the kanji-layout reading chips, and the bail flow are unchanged.

- [ ] **Step 2: Verify the imports and prop shapes**

Confirm:
- `VoicePrompt` is exported from `@kanji-learn/shared` (it is — `packages/shared/src/types.ts`).
- `VoiceEvaluator`'s `Props` includes an optional `voicePrompt?: VoicePrompt` (it does).
- `VoiceSuccessCard`'s props are `word`, `reading`, `targetKanji`, `kanjiMeaning`, `vocabMeaning`, `isLast`, `onNext` (unchanged from Plan B's usage).
- `api` is exported from `../../lib/api` relative to `apps/mobile/src/components/study/SpeakingLeg.tsx`.

If any differs, adapt and report the deviation.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @kanji-learn/mobile typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/study/SpeakingLeg.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): give the speaking leg the vocab-word layout

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 8: Session Complete — modality breakdown

**Files:**
- Modify: `apps/mobile/src/components/study/SessionComplete.tsx`
- Modify: `apps/mobile/app/(tabs)/study.tsx`

Session Complete gains a modality breakdown row — counts of flashcard / writing / speaking / quiz reps (spec §5 screen 3). The counts come from the review store's `modalityCounts` (Task 5).

- [ ] **Step 1: Add the `modalityCounts` prop to `SessionComplete`**

In `apps/mobile/src/components/study/SessionComplete.tsx`, add an import for the `ModalityCounts` type and a prop. The current import block is:

```tsx
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, spacing, radius, typography } from '../../theme'
import { motivationalMessage, didMeetTimeGoal } from './SessionComplete.messaging'
```

Add one line:

```tsx
import type { ModalityCounts } from '../../stores/review.store'
```

In the `Props` interface, after `dailyGoal: number`, add:

```ts
  /** user_profiles.daily_goal — the learner's daily minutes target */
  dailyGoal: number
  /** Per-modality rep counts for the session — the loop's practice breakdown. */
  modalityCounts: ModalityCounts
```

Add `modalityCounts` to the destructured parameter list:

```tsx
export function SessionComplete({ totalItems, correctItems, confidencePct, newLearned, burned, studyTimeMs, onDone, onReview, onKeepStudying, dailyGoal, modalityCounts }: Props) {
```

- [ ] **Step 2: Render the modality breakdown**

In `SessionComplete`'s JSX, the stats row (`<View style={styles.statsRow}>…</View>`) is followed by the actions block (`<View style={styles.actions}>`). Insert the modality breakdown between them — directly after the closing `</View>` of `statsRow` and before `<View style={styles.actions}>`:

```tsx
        {/* Modality breakdown — how the loop spent the session */}
        <View style={styles.modalityCard}>
          <Text style={styles.modalityTitle}>Practice breakdown</Text>
          <View style={styles.modalityRow}>
            <ModalityChip icon="albums-outline" value={modalityCounts.flashcard} label="Flashcard" />
            <ModalityChip icon="pencil-outline" value={modalityCounts.writing} label="Writing" />
            <ModalityChip icon="mic-outline" value={modalityCounts.speaking} label="Speaking" />
            <ModalityChip icon="help-circle-outline" value={modalityCounts.quiz} label="Quiz" />
          </View>
        </View>
```

Add the `ModalityChip` component directly after the existing `StatChip` function definition:

```tsx
function ModalityChip({ icon, value, label }: { icon: string; value: number; label: string }) {
  return (
    <View style={modalityChipStyles.item}>
      <Ionicons name={icon as any} size={18} color={colors.textSecondary} />
      <Text style={modalityChipStyles.value}>{value}</Text>
      <Text style={modalityChipStyles.label}>{label}</Text>
    </View>
  )
}

const modalityChipStyles = StyleSheet.create({
  item: { flex: 1, alignItems: 'center', gap: 2 },
  value: { ...typography.h3, color: colors.textPrimary },
  label: { ...typography.caption, color: colors.textMuted },
})
```

Add the card styles to the main `StyleSheet.create({...})` block (alongside `statsRow`):

```ts
  modalityCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  modalityTitle: { ...typography.bodySmall, color: colors.textMuted, fontWeight: '700' },
  modalityRow: { flexDirection: 'row', gap: spacing.sm },
```

- [ ] **Step 3: Pass `modalityCounts` from `study.tsx`**

In `apps/mobile/app/(tabs)/study.tsx`:

**(a)** Add the `ModalityCounts` type import near the other store import. The store is imported as `import { useReviewStore } from '../../src/stores/review.store'`. Add:

```ts
import type { ModalityCounts } from '../../src/stores/review.store'
```

**(b)** The `sessionSummary` state holds the Session Complete data. Its type literal currently is:

```ts
  const [sessionSummary, setSessionSummary] = useState<{
    totalItems: number; correctItems: number; confidencePct: number; newLearned: number; burned: number; studyTimeMs: number
    dailyGoal: number
  } | null>(null)
```

Add `modalityCounts`:

```ts
  const [sessionSummary, setSessionSummary] = useState<{
    totalItems: number; correctItems: number; confidencePct: number; newLearned: number; burned: number; studyTimeMs: number
    dailyGoal: number
    modalityCounts: ModalityCounts
  } | null>(null)
```

**(c)** `handleFinish` builds the `sessionSummary` in two `setSessionSummary({...})` calls (the success path and the `catch` fallback). In **both** objects, add `modalityCounts`. Read it from the store at the top of `handleFinish` — directly after the existing `const { results } = useReviewStore.getState()` line, add:

```ts
    const { modalityCounts } = useReviewStore.getState()
```

Then add `modalityCounts,` to both `setSessionSummary({ … })` object literals (alongside `dailyGoal`).

(The `<SessionComplete {...sessionSummary} … />` render spreads `sessionSummary`, so `modalityCounts` flows through automatically once it is in the object.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @kanji-learn/mobile typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/study/SessionComplete.tsx "apps/mobile/app/(tabs)/study.tsx"
git commit -m "$(cat <<'EOF'
feat(mobile): show the modality breakdown on Session Complete

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 9: The Ready screen

**Files:**
- Create: `apps/mobile/src/components/study/ReadyScreen.tsx`
- Modify: `apps/mobile/app/(tabs)/study.tsx`

The Study tab opens on a "today's plan" screen (spec §5 screen 1) — the minutes budget, the due-review count, and a Begin action — before the loop loads. Weak/missed drills (which load their queue before navigation) skip it.

- [ ] **Step 1: Create `ReadyScreen.tsx`**

Create `apps/mobile/src/components/study/ReadyScreen.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { api } from '../../lib/api'
import { colors, spacing, radius, typography } from '../../theme'

interface Props {
  /** The learner's daily minutes budget. */
  goalMinutes: number
  onBegin: () => void
}

/**
 * The Practice Loop's Ready screen (spec §5 screen 1) — today's plan: the
 * minutes budget and the due-review count, with a Begin action. Shown when the
 * learner opens the Study tab before a session has started.
 */
export function ReadyScreen({ goalMinutes, onBegin }: Props) {
  const [dueCount, setDueCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    api.get<{ dueCount: number }>('/v1/review/status')
      .then((s) => { if (!cancelled) setDueCount(s.dueCount) })
      .catch(() => { if (!cancelled) setDueCount(null) })
    return () => { cancelled = true }
  }, [])

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.content}>
        <Ionicons name="book" size={64} color={colors.primary} />
        <Text style={styles.title}>Today's practice</Text>
        <Text style={styles.subtitle}>
          A {goalMinutes}-minute session. Each kanji is routed through the
          modalities it needs.
        </Text>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{goalMinutes}</Text>
            <Text style={styles.statLabel}>minutes</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{dueCount === null ? '—' : dueCount}</Text>
            <Text style={styles.statLabel}>reviews due</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.beginBtn} onPress={onBegin} activeOpacity={0.85}>
          <Text style={styles.beginText}>Begin</Text>
          <Ionicons name="arrow-forward" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xl, gap: spacing.lg,
  },
  title: { ...typography.h1, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  statsRow: { flexDirection: 'row', gap: spacing.md, width: '100%' },
  statCard: {
    flex: 1, alignItems: 'center', gap: spacing.xs,
    backgroundColor: colors.bgCard, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.lg,
  },
  statValue: { ...typography.h1, color: colors.textPrimary },
  statLabel: { ...typography.caption, color: colors.textMuted },
  beginBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.primary, borderRadius: radius.lg,
    paddingVertical: spacing.md, paddingHorizontal: spacing.xxl, marginTop: spacing.md,
  },
  beginText: { ...typography.h3, color: '#fff' },
})
```

(`GET /v1/review/status` returns `{ ok: true, data: { unseen, learning, reviewing, remembered, burned, dueCount } }`; `api.get<{ dueCount: number }>` yields the `data` object.)

- [ ] **Step 2: Add the Ready-screen phase to `study.tsx`**

In `apps/mobile/app/(tabs)/study.tsx`:

**(a)** Import `ReadyScreen` near the other `src/components/study/...` imports:

```ts
import { ReadyScreen } from '../../src/components/study/ReadyScreen'
```

**(b)** Add a `phase` state. Directly after the `const [isRevealed, setIsRevealed] = useState(false)` line (the first `useState` in the component), add:

```ts
  // The Study tab opens on the Ready screen ('ready'); Begin loads the queue
  // and switches to 'active'. A weak/missed drill loads its queue before
  // navigation, so it starts straight in 'active'.
  const [phase, setPhase] = useState<'ready' | 'active'>(
    () => (useReviewStore.getState().isWeakDrill ? 'active' : 'ready')
  )
```

**(c)** The mount `useEffect` currently calls `loadQueue` unless `isWeakDrill`:

```tsx
  useEffect(() => {
    if (!profile) return
    syncPendingSessions()
    if (!useReviewStore.getState().isWeakDrill) {
      loadQueue(dailyGoal)
    }
    return () => reset()
  }, [profile])
```

Replace it with — the queue is no longer auto-loaded; the Ready screen's Begin action loads it:

```tsx
  useEffect(() => {
    if (!profile) return
    syncPendingSessions()
    // The queue is loaded on demand — a normal session loads it from the
    // Ready screen's Begin action; weak/missed drills load it before
    // navigation (and start in the 'active' phase).
    return () => reset()
  }, [profile])
```

**(d)** Add a `handleBegin` callback. Place it near the other `useCallback` handlers (e.g. directly before `handleFinish`):

```tsx
  const handleBegin = useCallback(() => {
    setPhase('active')
    loadQueue(dailyGoal)
  }, [loadQueue, dailyGoal])
```

**(e)** Render the Ready screen. It must render **before** the `if (isLoading)` early return (the store's `isLoading` initialises to `true` and now stays `true` until Begin, so the loading branch would otherwise mask the Ready screen). It must also come **after every hook** in the component (all `useState`/`useEffect`/`useCallback`/`useRef`) so it does not violate the rules of hooks. `if (isLoading)` is currently the **first early return** in the component — every hook is above it. Insert the Ready-screen branch immediately above `if (isLoading)` (it becomes the new first early return). The `if (isLoading) {` line below is shown only as the placement anchor — do not duplicate it:

```tsx
  // ── Ready screen ──────────────────────────────────────────────────────────
  if (phase === 'ready') {
    return <ReadyScreen goalMinutes={dailyGoal} onBegin={handleBegin} />
  }

  // ── Loading ──────────────────────────────────────────────────────────────

  if (isLoading) {
```

**(f)** When a session ends, the user returns to the Ready screen on next entry. In the `<SessionComplete>` render, the `onDone` handler currently does `setSessionSummary(null); reset(); router.replace('/(tabs)')`. Add `setPhase('ready')` so a fresh Study-tab entry shows the Ready screen (Expo Router keeps the tab mounted, so component state persists):

```tsx
        onDone={() => {
          setSessionSummary(null)
          reset()
          setPhase('ready')
          router.replace('/(tabs)')
        }}
```

(`onKeepStudying` and `onReview` keep the user in `phase: 'active'` — no change to those handlers.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @kanji-learn/mobile typecheck`
Expected: no errors.

- [ ] **Step 4: Run the mobile test suite**

From `apps/mobile`: `npx jest`
Expected: all suites green (the 37 existing tests).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/study/ReadyScreen.tsx "apps/mobile/app/(tabs)/study.tsx"
git commit -m "$(cat <<'EOF'
feat(mobile): add the Ready screen to the study loop

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 10: Navigation — promote Browse to a tab

**Files:**
- Create (via `git mv`): `apps/mobile/app/(tabs)/browse.tsx`
- Delete (via `git mv`): `apps/mobile/app/browse.tsx`
- Modify: `apps/mobile/app/(tabs)/_layout.tsx`
- Modify: `apps/mobile/app/_layout.tsx`
- Modify: `apps/mobile/app/(tabs)/progress.tsx`

The Kanji Browser is currently a modal route opened from a button inside the Progress tab. Spec §1 promotes it to a first-class tab. The tab bar goes 5 → 6: **Dashboard · Study · Browse · Journal · Progress · Profile**.

- [ ] **Step 1: Move the file into `(tabs)/`**

```bash
git mv apps/mobile/app/browse.tsx "apps/mobile/app/(tabs)/browse.tsx"
```

- [ ] **Step 2: Fix the import depth in the moved file**

The file moved one directory deeper (`app/` → `app/(tabs)/`), so its `../src/...` imports must become `../../src/...`. In `apps/mobile/app/(tabs)/browse.tsx`, the import block currently reads:

```tsx
import { api } from '../src/lib/api'
import { colors, spacing, radius, typography } from '../src/theme'
```

Change both to:

```tsx
import { api } from '../../src/lib/api'
import { colors, spacing, radius, typography } from '../../src/theme'
```

- [ ] **Step 3: Convert the modal header into a tab header**

`browse.tsx` is a modal screen — it imports `SafeAreaView` from `react-native` and its header has a `chevron-down` close button calling `router.back()`. A tab has nothing to go "back" to. Make two edits.

**(a)** Change the `SafeAreaView` import to come from `react-native-safe-area-context` (the convention for tab screens). The current React-Native import line is:

```tsx
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, SafeAreaView,
} from 'react-native'
```

Change it to drop `SafeAreaView` from there, and add the context import below it:

```tsx
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
```

And change the screen's root element from `<SafeAreaView style={styles.safe}>` to `<SafeAreaView style={styles.safe} edges={['top']}>`.

**(b)** Remove the close button from the header. The header block currently is:

```tsx
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-down" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Browse Kanji</Text>
        <Text style={styles.count}>{total.toLocaleString()}</Text>
      </View>
```

Replace it with (drop the `TouchableOpacity`):

```tsx
      <View style={styles.header}>
        <Text style={styles.title}>Browse Kanji</Text>
        <Text style={styles.count}>{total.toLocaleString()}</Text>
      </View>
```

Then delete the now-unused `backBtn` style from the `StyleSheet.create` block (the line `backBtn: { padding: 4 },`). Leave everything else — `useRouter`/`router` is still used for `router.push(\`/kanji/${item.id}\`)`, and the `header` style still works with two children.

- [ ] **Step 4: Add the Browse `Tabs.Screen`**

In `apps/mobile/app/(tabs)/_layout.tsx`, add a Browse tab between `study` and `journal`. After the `<Tabs.Screen name="study" … />` block and before `<Tabs.Screen name="journal" … />`, insert:

```tsx
      <Tabs.Screen
        name="browse"
        options={{
          title: 'Browse',
          tabBarIcon: ({ focused }) => <TabIcon name="search" focused={focused} />,
        }}
      />
```

- [ ] **Step 5: Remove the modal `Stack.Screen` for browse**

In `apps/mobile/app/_layout.tsx`, delete the line:

```tsx
        <Stack.Screen name="browse" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
```

Leave the other `Stack.Screen` entries unchanged.

- [ ] **Step 6: Remove the redundant Browse button from the Progress tab**

In `apps/mobile/app/(tabs)/progress.tsx`, the header has a Browse button (Browse is now a tab, so the button is redundant). Delete the `TouchableOpacity` block:

```tsx
          <TouchableOpacity style={styles.browseBtn} onPress={() => router.push('/browse')}>
            <Ionicons name="search" size={14} color={colors.primary} />
            <Text style={styles.browseBtnText}>Browse</Text>
          </TouchableOpacity>
```

The surrounding header `<View style={styles.header}>` keeps its remaining child (the title `<View style={{ gap: 2 }}>…</View>`) — leave that. Then delete the two now-unused styles from the `StyleSheet.create` block:

```ts
  browseBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: colors.primary + '66',
    borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 6,
  },
  browseBtnText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
```

Leave the `header` style. Do not remove the `useRouter` import or the `router` value — `progress.tsx` uses `router` elsewhere; if a typecheck pass shows `router` is genuinely unused after this edit, only then remove it.

- [ ] **Step 7: Confirm no dangling references**

Run: `grep -rn "'/browse'\|\"/browse\"\|name=\"browse\"" apps/mobile/app apps/mobile/src`
Expected: zero hits. The route `/(tabs)/browse` is now resolved by expo-router file-routing; nothing should reference the old `/browse` path or the deleted `Stack.Screen name="browse"`.

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @kanji-learn/mobile typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add "apps/mobile/app/(tabs)/browse.tsx" "apps/mobile/app/(tabs)/_layout.tsx" "apps/mobile/app/_layout.tsx" "apps/mobile/app/(tabs)/progress.tsx"
git commit -m "$(cat <<'EOF'
feat(mobile): promote Browse to a tab

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

(`git mv` in Step 1 staged the rename; Step 9's `git add` of the new path plus the three edited files captures the full change.)

---

## Final verification

- [ ] **Typecheck both packages**

```bash
pnpm --filter @kanji-learn/mobile typecheck
pnpm --filter @kanji-learn/api typecheck
```
Expected: no new errors. `apps/api` has one pre-existing unrelated error at `test/integration/social-mute.test.ts:25` — not introduced here.

- [ ] **Run the test suites**

```bash
# from apps/mobile:
npx jest
# API (from repo root):
pnpm --filter @kanji-learn/api test
```
Expected: mobile — all suites green (the 37 existing tests). API — the unit suites green, including the new `recentlyShaky` cases. (API integration tests that hit a real Postgres DB may fail on environment/DB-state issues unrelated to this plan — distinguish those from unit results.)

- [ ] **On-device walkthrough** (next EAS build or a local dev client)
  - The tab bar shows **6** tabs: Dashboard · Study · Browse · Journal · Progress · Profile. The Browse tab opens the kanji browser; the Progress tab no longer has a Browse button.
  - Opening the Study tab shows the **Ready screen** (today's minutes + due count + Begin); Begin starts the loop.
  - Grade a review kanji **Good/Easy** that is "maybe slipping" (a recently-shaky kanji, or a burned-tier card) → a **quiz** question appears. **Pass** → advances to the next kanji. **Fail** → routes to writing → speaking, and the card's flashcard grade is downgraded (it will resurface sooner — confirm on a later session).
  - Grade an unflagged Good/Easy review kanji → advances straight on (no quiz).
  - New kanji and Again/Hard review kanji still run writing → speaking (no quiz leg).
  - The **Speaking leg** shows the vocab-word layout (a vocab word + pitch reading) for kanji that have example vocab; the legacy kanji-reading layout otherwise.
  - **Session Complete** shows the practice breakdown (flashcard / writing / speaking / quiz counts).
  - After a quiz, a row exists in `testSessions` (`test_type = 'loop_check'`) and `testResults` (telemetry — spec §6).

---

## Notes for the executor

- **Order matters.** Tasks 1–2 (API) come first — the `maybeSlipping` type (Task 1) and the quiz-question endpoint (Task 2) are needed downstream. Task 3 (QuizQuestion) before Task 4 (QuizLeg). Tasks 5→6 are a pair: Task 5 makes the store route to `leg: 'quiz'`; Task 6 teaches `study.tsx` to render it. Run 5 then 6 with nothing in between (mirrors Plan B's 4→5). Tasks 7–10 are independent of each other and can run in any order after Task 6, but the listed order is fine.
- **Three tasks edit `study.tsx`** (6, 8, 9) in different regions — the quiz-leg branch, the `sessionSummary`/`handleFinish` modality plumbing, and the Ready-screen phase. Each task's anchors are exact; apply them in order.
- **The API needs a deploy.** Tasks 1–2 change `apps/api` (`srs.service.ts`, `test.service.ts`, `test.ts`). The `maybeSlipping` flag and the quiz-question endpoint will not work on-device until `./scripts/deploy-api.sh` is run.
- **No DB migration.** Spec §6: Plan C introduces no new tables. `maybeSlipping` is a computed API-response field; `testType: 'loop_check'` is just a string value written to the existing `testSessions.test_type` column.
- **Telemetry (spec §6) comes for free.** Writing → `writingAttempts` and Speaking → `voiceAttempts` are recorded by `WritingPractice`/`VoiceEvaluator` themselves; the quiz leg records `testSessions`/`testResults` via `POST /v1/tests/submit`; the flashcard grade records `reviewLogs` via `POST /v1/review/submit`. No dedicated telemetry task.
- **`test.tsx` is untouched.** Per the scope decision, the standalone quiz screen stays as-is. `QuizQuestion` is a fresh component; `test.tsx` could later be refactored to consume it (out of scope).
- **Resume edge case (carried over from Plan B, acceptable for v1).** `submitResult` persists the flashcard grade at grade time. If the app is killed mid-quiz/mid-writing/mid-speaking, resume restores `currentIndex` past that kanji and skips its remaining legs. A quiz fail's grade-downgrade only persists if `failQuizLeg` ran before the kill. This is a minor, accepted v1 limitation.
- **Deferred:** the FSRS migration (Spec 1.5) and Buddy (Spec 2) each get their own brainstorm after Plan C ships.
