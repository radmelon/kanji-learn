# B126 UX Polish Bundle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five bundled UX changes in B126: daily-goal progress indicator + celebration banner, the `"All caught up!"` flash-race fix, study-card vocab speak icons, and three Kanjidic2 reference codes surfaced on the kanji details page (Hadamitzky-Spahn, Kyōiku grade, frequency rank).

**Architecture:** Mobile-centric with one small API change. Section 5 extends `/v1/kanji/:id` to return three fields already present on the Drizzle `kanji` schema (migration 0019). All other sections live entirely in the mobile app. One API deploy, one EAS build (B126).

**Tech Stack:** TypeScript, Fastify, Drizzle ORM (no schema changes), React Native (Expo), Zustand, Jest (ts-jest, `testMatch: test/**/*.test.ts`), vitest (apps/api).

**Spec reference:** [docs/superpowers/specs/2026-04-20-daily-goal-celebration-design.md](../specs/2026-04-20-daily-goal-celebration-design.md)

---

## File Structure

```
apps/api/src/routes/kanji.ts                                     ← MODIFY (SELECT 3 new fields)
apps/mobile/src/components/study/SessionComplete.messaging.ts    ← MODIFY (add didCrossGoal helper)
apps/mobile/test/unit/SessionComplete.messaging.test.ts          ← MODIFY (add didCrossGoal tests)
apps/mobile/src/components/study/SessionComplete.tsx             ← MODIFY (new props + celebration banner)
apps/mobile/src/stores/review.store.ts                           ← MODIFY (isLoading: true initial state)
apps/mobile/app/(tabs)/study.tsx                                 ← MODIFY (thread reviewedBefore + dailyGoal to SessionComplete)
apps/mobile/app/(tabs)/index.tsx                                 ← MODIFY (progress indicator under CTA)
apps/mobile/src/components/study/KanjiCard.tsx                   ← MODIFY (SpeakButton on vocab rows)
apps/mobile/app/kanji/[id].tsx                                   ← MODIFY (type + formatGrade + Cross-references rows)
BUGS.md                                                          ← MODIFY (flash-race Fixed entry)
ENHANCEMENTS.md                                                  ← MODIFY (B126 Shipped entries)
```

---

## Task 1: API — extend `/v1/kanji/:id` SELECT with Kanjidic2 refs

**Files:**
- Modify: `apps/api/src/routes/kanji.ts` around line 218

- [ ] **Step 1: Add the three new fields to the SELECT**

Find the `/v1/kanji/:id` handler's select block (around line 218). Locate:

```ts
        jisCode: kanji.jisCode,
        nelsonClassic: kanji.nelsonClassic,
        nelsonNew: kanji.nelsonNew,
        morohashiIndex: kanji.morohashiIndex,
        morohashiVolume: kanji.morohashiVolume,
        morohashiPage: kanji.morohashiPage,
```

Append three lines:

```ts
        jisCode: kanji.jisCode,
        nelsonClassic: kanji.nelsonClassic,
        nelsonNew: kanji.nelsonNew,
        morohashiIndex: kanji.morohashiIndex,
        morohashiVolume: kanji.morohashiVolume,
        morohashiPage: kanji.morohashiPage,
        grade: kanji.grade,
        frequencyRank: kanji.frequencyRank,
        hadamitzkySpahn: kanji.hadamitzkySpahn,
```

- [ ] **Step 2: Typecheck**

Run from repo root:
```
cd apps/api && pnpm typecheck
```
Expected: no errors. (`kanji.grade`, `kanji.frequencyRank`, `kanji.hadamitzkySpahn` already exist on the Drizzle schema from migration 0019.)

- [ ] **Step 3: Run the API test suite**

Run from repo root:
```
cd apps/api && pnpm test
```
Expected: same pass rate as before (169/170 — the one pre-existing `learner_identity_pkey` duplicate is unrelated). No new failures.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/kanji.ts
git commit -m "$(cat <<'EOF'
feat(api): extend /v1/kanji/:id with Kanjidic2 reference fields

Adds grade, frequencyRank, and hadamitzkySpahn to the detail response.
Columns were created and populated in Phase 2 (migration 0019 +
seed-kanjidic-refs) but never surfaced through the API. Mobile details
page will consume these in B126.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 2: Deploy the API + smoke-test the new fields

**Files:** none (deployment action)

- [ ] **Step 1: Build the API image and push + trigger App Runner**

Run from repo root:
```
DOCKER_CONTEXT=default ./scripts/deploy-api.sh
```
Expected: Docker build succeeds, image pushed to ECR, `aws apprunner start-deployment` triggered, operation ID printed. Typical build+push: 2–4 min; App Runner deploy: 3–5 min.

- [ ] **Step 2: Poll App Runner until the deploy reaches SUCCEEDED**

Run from repo root:
```
until [ "$(aws apprunner list-operations \
  --service-arn 'arn:aws:apprunner:us-east-1:087656010655:service/kanji-learn-api/470f4fc9f81c407e871228fb9dd93654' \
  --region us-east-1 --max-results 1 \
  --query 'OperationSummaryList[0].Status' --output text)" != "IN_PROGRESS" ]; do sleep 30; done \
&& aws apprunner list-operations \
  --service-arn 'arn:aws:apprunner:us-east-1:087656010655:service/kanji-learn-api/470f4fc9f81c407e871228fb9dd93654' \
  --region us-east-1 --max-results 1 \
  --query 'OperationSummaryList[0].{Id:Id,Status:Status,EndedAt:EndedAt}' --output json
```
Expected: `Status: SUCCEEDED`.

- [ ] **Step 3: Health-check the deployed service**

Run from repo root:
```
curl -sS -o /dev/null -w "HTTP %{http_code} in %{time_total}s\n" https://73x3fcaaze.us-east-1.awsapprunner.com/health
```
Expected: `HTTP 200 in <1s`.

- [ ] **Step 4: Verify the /v1/kanji/:id response includes the new fields**

The endpoint requires a valid JWT. Rather than extract one, use the `/v1/kanji/:id` unauth response shape check: without auth the route returns 401, which confirms the route is still wired. Full functional verification happens on-device in Task 11.

Alternative if a valid JWT is convenient in the local shell:
```
curl -sS -H "Authorization: Bearer $JWT" https://73x3fcaaze.us-east-1.awsapprunner.com/v1/kanji/2 | jq '{grade, frequencyRank, hadamitzkySpahn}'
```
Expected: object containing the three fields (values depend on which ID is fetched).

- [ ] **Step 5: Note the operation ID for the HANDOFF update in Task 10**

The `OperationSummaryList[0].Id` from Step 2 is the op ID to record.

---

## Task 3: Add `didCrossGoal` pure helper (TDD)

**Files:**
- Modify: `apps/mobile/test/unit/SessionComplete.messaging.test.ts`
- Modify: `apps/mobile/src/components/study/SessionComplete.messaging.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/mobile/test/unit/SessionComplete.messaging.test.ts` (below the existing `motivationalMessage` describe block):

```ts
import { didCrossGoal } from '../../src/components/study/SessionComplete.messaging'

describe('didCrossGoal', () => {
  it('is true when the session crosses from below to at-or-above the goal', () => {
    expect(didCrossGoal(4, 5, 5)).toBe(true)   // 4 + 5 reviewed ≥ 5
    expect(didCrossGoal(0, 5, 5)).toBe(true)   // first-session crossing
    expect(didCrossGoal(2, 10, 5)).toBe(true)  // crosses by overshooting
  })

  it('is false when already at or above the goal before the session', () => {
    expect(didCrossGoal(5, 3, 5)).toBe(false)  // already met
    expect(didCrossGoal(7, 5, 5)).toBe(false)  // overshooting again after meeting
  })

  it('is false when still below the goal after the session', () => {
    expect(didCrossGoal(0, 3, 5)).toBe(false)
    expect(didCrossGoal(2, 2, 5)).toBe(false)
  })

  it('handles dailyGoal = 1 edge case', () => {
    expect(didCrossGoal(0, 1, 1)).toBe(true)
    expect(didCrossGoal(1, 1, 1)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run from repo root:
```
cd apps/mobile && pnpm exec jest SessionComplete.messaging
```
Expected: the 6 existing `motivationalMessage` tests pass; the new `didCrossGoal` suite fails with "didCrossGoal is not a function" or similar import error.

- [ ] **Step 3: Add the helper to `SessionComplete.messaging.ts`**

Append to `apps/mobile/src/components/study/SessionComplete.messaging.ts`:

```ts
/**
 * True when this session is the one that crossed the daily-goal threshold
 * for the first time today. Used by SessionComplete to decide whether to
 * render the one-time 🎉 celebration banner.
 *
 * @param reviewedBefore  daily_stats.reviewed BEFORE this session's submit
 * @param totalItems      cards reviewed in the session just completed
 * @param dailyGoal       user's configured target from user_profiles.daily_goal
 */
export function didCrossGoal(
  reviewedBefore: number,
  totalItems: number,
  dailyGoal: number,
): boolean {
  return reviewedBefore < dailyGoal && reviewedBefore + totalItems >= dailyGoal
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run:
```
cd apps/mobile && pnpm exec jest SessionComplete.messaging
```
Expected: PASS (now 10 tests total — 6 `motivationalMessage` + 4 `didCrossGoal`).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/study/SessionComplete.messaging.ts apps/mobile/test/unit/SessionComplete.messaging.test.ts
git commit -m "$(cat <<'EOF'
feat(mobile): didCrossGoal helper for daily-goal celebration

Pure boolean helper in SessionComplete.messaging.ts that decides
whether the current session is the one that crossed the daily-goal
threshold for the first time today. 4 unit tests cover above/below
boundary cases and the dailyGoal=1 edge.

Used by SessionComplete (next task) to conditionally render the
🎉 'Daily goal met' banner exactly once per crossing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 4: Flash-race fix — `isLoading: true` initial state

**Files:**
- Modify: `apps/mobile/src/stores/review.store.ts` around line 68

- [ ] **Step 1: Change the initial `isLoading` value**

Open `apps/mobile/src/stores/review.store.ts`. Locate:

```ts
  queue: [],
  currentIndex: 0,
  results: [],
  isLoading: false,
  isComplete: false,
```

Replace with:

```ts
  queue: [],
  currentIndex: 0,
  results: [],
  // Initial true so study.tsx's "All caught up!" branch (guarded by
  // `!isLoading && queue.length === 0`) doesn't flash for a render
  // frame on cold mount before the effect fires loadQueue().
  isLoading: true,
  isComplete: false,
```

- [ ] **Step 2: Typecheck**

Run:
```
cd apps/mobile && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 3: Run the mobile test suite**

Run:
```
cd apps/mobile && pnpm exec jest
```
Expected: all suites pass (same count as Task 3's final state).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/stores/review.store.ts
git commit -m "$(cat <<'EOF'
fix(mobile): review store isLoading initial true to prevent caught-up flash

The Study screen's empty-state branch fires on `!isLoading && queue.length === 0`.
Initial state had `isLoading: false` and `queue: []`, so the 'All caught up!'
view rendered for one frame on cold mount before the effect fired loadQueue
and flipped isLoading back to true. Observed in B125 as a ~2s flash between
session launches.

Switching initial to `isLoading: true` delays the empty state until loadQueue
genuinely returns zero cards — the honest exhausted-queue signal.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 5: SessionComplete — new props + celebration banner

**Files:**
- Modify: `apps/mobile/src/components/study/SessionComplete.tsx`
- Modify: `apps/mobile/app/(tabs)/study.tsx` (thread new props from session summary)

- [ ] **Step 1: Extend SessionComplete Props interface**

Open `apps/mobile/src/components/study/SessionComplete.tsx`. Locate:

```ts
interface Props {
  totalItems: number
  correctItems: number
  confidencePct: number
  newLearned: number
  burned: number
  studyTimeMs: number
  onDone: () => void
  onReview: () => void
}
```

Replace with:

```ts
interface Props {
  totalItems: number
  correctItems: number
  confidencePct: number
  newLearned: number
  burned: number
  studyTimeMs: number
  onDone: () => void
  onReview: () => void
  /** daily_stats.reviewed BEFORE this session — used to detect goal crossing */
  reviewedBefore: number
  /** user_profiles.daily_goal — used to detect goal crossing */
  dailyGoal: number
}
```

- [ ] **Step 2: Import `didCrossGoal` and destructure the new props**

Edit the import line:

```ts
import { motivationalMessage } from './SessionComplete.messaging'
```

Replace with:

```ts
import { motivationalMessage, didCrossGoal } from './SessionComplete.messaging'
```

Update the destructure signature on the `SessionComplete` function:

```ts
export function SessionComplete({ totalItems, correctItems, confidencePct, newLearned, burned, studyTimeMs, onDone, onReview, reviewedBefore, dailyGoal }: Props) {
```

- [ ] **Step 3: Compute `showGoalBanner` and render the banner**

Immediately below the `accColor` line (currently around line 39), add:

```ts
  const showGoalBanner = burned === 0 && didCrossGoal(reviewedBefore, totalItems, dailyGoal)
```

(`burned === 0` enforces the precedence rule from the spec: burned-kanji message wins when both would apply.)

Then inside the JSX, above the existing `<View style={styles.hero}>` block, add:

```tsx
        {showGoalBanner && (
          <View style={styles.goalBanner}>
            <Text style={styles.goalBannerText}>🎉 Daily goal met — nice work.</Text>
          </View>
        )}
```

- [ ] **Step 4: Add the banner styles to the SessionComplete StyleSheet**

Find the existing `StyleSheet.create({ ... })` block at the bottom of the file. Add two new keys:

```ts
  goalBanner: {
    alignSelf: 'center',
    marginTop: spacing.md,
    marginBottom: -spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.success + '22',
    borderWidth: 1,
    borderColor: colors.success,
  },
  goalBannerText: {
    ...typography.bodySmall,
    color: colors.success,
    fontWeight: '600',
  },
```

(The `colors.success + '22'` tinted background with full-saturation `colors.success` label mirrors the Rōmaji-chip active-state pattern and clears WCAG AA for normal text per the feedback_accessibility_wcag memory.)

- [ ] **Step 5: Thread `reviewedBefore` + `dailyGoal` into the sessionSummary in study.tsx**

Open `apps/mobile/app/(tabs)/study.tsx`. Find the component's state + hook section near the top. Add a call to `useAnalytics` to read today's stats at mount. Near the top of the `StudySession` function (around the other hooks at line ~50), add:

```ts
  const { summary: analyticsSummary } = useAnalytics()
```

Add the import at the top of the file with the other hook imports:

```ts
import { useAnalytics } from '../../src/hooks/useAnalytics'
```

Locate the `setSessionSummary({ ... })` call (around line 306). The current object includes `totalItems, correctItems, confidencePct, newLearned, burned, studyTimeMs`. Extend it with:

```ts
      // Today's reviewed count BEFORE the current session's submit lands in daily_stats.
      // analyticsSummary is cached-or-fresh from useAnalytics; if not yet loaded, fall
      // back to 0 so the banner only fires on a genuine first-time crossing.
      const today = new Date().toISOString().slice(0, 10)
      const reviewedBefore = analyticsSummary?.recentStats.find((r) => r.date === today)?.reviewed ?? 0

      setSessionSummary({
        totalItems: results.length,
        correctItems: correct,
        confidencePct: serverData?.confidencePct ?? fallbackConfidence,
        newLearned,
        burned: serverData?.burned ?? 0,
        studyTimeMs: serverData?.studyTimeMs ?? clientStudyMs,
        reviewedBefore,
        dailyGoal,
      })
```

Also update the error-fallback `setSessionSummary` call a few lines below (currently around line 317) to include the same two fields with a fallback of `reviewedBefore: 0`:

```ts
      setSessionSummary({
        totalItems: results.length,
        correctItems: correct,
        confidencePct: fallbackConfidence,
        newLearned,
        burned: 0,
        studyTimeMs: clientStudyMs,
        reviewedBefore: 0,
        dailyGoal,
      })
```

Update the `sessionSummary` state type (currently around line 62) to include the two new fields:

```ts
  const [sessionSummary, setSessionSummary] = useState<{
    totalItems: number; correctItems: number; confidencePct: number; newLearned: number; burned: number; studyTimeMs: number
    reviewedBefore: number; dailyGoal: number
  } | null>(null)
```

- [ ] **Step 6: Typecheck**

Run:
```
cd apps/mobile && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 7: Run the SessionComplete messaging tests (regression check)**

Run:
```
cd apps/mobile && pnpm exec jest SessionComplete.messaging
```
Expected: 10/10 still pass.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/components/study/SessionComplete.tsx 'apps/mobile/app/(tabs)/study.tsx'
git commit -m "$(cat <<'EOF'
feat(mobile): 🎉 daily-goal celebration banner in SessionComplete

Renders a green 'Daily goal met — nice work.' banner above the hero
on the session that crosses daily_stats.reviewed past profile.dailyGoal
for the first time today. Suppressed when burned > 0 (burned-kanji
message takes precedence).

Reads reviewedBefore from useAnalytics().summary.recentStats in
study.tsx and threads it plus dailyGoal through to SessionComplete
via the sessionSummary state. Banner style uses colors.success +
22% tint background with full-saturation label — mirrors the existing
Rōmaji toggle chip pattern, clears WCAG AA.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 6: Dashboard progress indicator

**Files:**
- Modify: `apps/mobile/app/(tabs)/index.tsx` around line 277

- [ ] **Step 1: Compute today's reviewed count from existing useAnalytics data**

The Dashboard already destructures `summary` from `useAnalytics()` at line 183. Near that hook call, derive today's progress. Add these two lines immediately after the existing `const { summary, isLoading, isStale, refresh } = useAnalytics()`:

```ts
  const todayKey = new Date().toISOString().slice(0, 10)
  const reviewedToday = summary?.recentStats.find((r) => r.date === todayKey)?.reviewed ?? 0
```

- [ ] **Step 2: Read dailyGoal from useProfile**

The Dashboard may or may not already call `useProfile`. Search the file for `useProfile`. If missing, add the import with the other hook imports at the top:

```ts
import { useProfile } from '../../src/hooks/useProfile'
```

And inside `DashboardScreen` (or whatever the component is named), near the `useAnalytics` line, add:

```ts
  const { profile } = useProfile()
  const dailyGoal = profile?.dailyGoal ?? 20
```

(Skip this step if both are already present.)

- [ ] **Step 3: Add the progress indicator below the Start Today's Reviews button**

Locate the Start Today's Reviews `<TouchableOpacity>` block (around line 277). Immediately after the closing `</TouchableOpacity>` of that block, insert:

```tsx
        {/* Daily progress indicator — soft target, no gate */}
        <View style={styles.progressRow}>
          <Text style={styles.progressText}>
            {reviewedToday} / {dailyGoal} today
          </Text>
          {reviewedToday >= dailyGoal && (
            <Ionicons name="checkmark-circle" size={14} color={colors.success} />
          )}
        </View>
```

- [ ] **Step 4: Add the `progressRow` and `progressText` styles**

Find the `styles = StyleSheet.create({ ... })` block at the bottom of `index.tsx`. Add two new keys:

```ts
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  progressText: {
    ...typography.caption,
    color: colors.textMuted,
  },
```

(Note: the dashboard may have a `progressText` key already used for something else — if `pnpm typecheck` or a name collision shows up in Step 5, rename these to `goalProgressRow` / `goalProgressText` and update the JSX reference accordingly.)

- [ ] **Step 5: Typecheck**

Run:
```
cd apps/mobile && pnpm typecheck
```
Expected: no errors. If a style-name collision occurs, rename as noted in Step 4.

- [ ] **Step 6: Commit**

```bash
git add 'apps/mobile/app/(tabs)/index.tsx'
git commit -m "$(cat <<'EOF'
feat(mobile): Dashboard daily-goal progress indicator

Reads reviewedToday from useAnalytics().summary.recentStats (no new
network call — piggybacks on the existing cached/fresh summary fetch).
Displays 'N / M today' below the Start Today's Reviews CTA with a
success-coloured checkmark when N >= M. No cap on the CTA — goal is
a target, not a gate (deferred to the future Three-Modality Loop).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 7: Study-card vocab speak icons (parity gap)

**Files:**
- Modify: `apps/mobile/src/components/study/KanjiCard.tsx` around line 316

- [ ] **Step 1: Add SpeakButton to each vocab row in the main reveal panel**

Open `apps/mobile/src/components/study/KanjiCard.tsx`. Locate the reveal-panel vocab block (around line 316):

```tsx
          {/* Example vocab — first 2 entries */}
          {exampleVocab.length > 0 && (
            <View style={styles.vocab}>
              {exampleVocab.map((v, i) => (
                <View key={i} style={styles.vocabRow}>
                  <Text style={styles.vocabItem}>{v.word}【</Text>
                  <PitchAccentReading
                    reading={v.reading}
                    pattern={v.pitchPattern}
                    enabled={showPitchAccent}
                    size="small"
                  />
                  <Text style={styles.vocabItem}>】{'  '}{v.meaning}</Text>
                </View>
              ))}
            </View>
          )}
```

Replace with:

```tsx
          {/* Example vocab — first 2 entries */}
          {exampleVocab.length > 0 && (
            <View style={styles.vocab}>
              {exampleVocab.map((v, i) => {
                const groupKey = `vocab-${i}`
                return (
                  <View key={i} style={styles.vocabRow}>
                    <Text style={styles.vocabItem}>{v.word}【</Text>
                    <PitchAccentReading
                      reading={v.reading}
                      pattern={v.pitchPattern}
                      enabled={showPitchAccent}
                      size="small"
                    />
                    <Text style={styles.vocabItem}>】{'  '}{v.meaning}</Text>
                    <SpeakButton
                      groupKey={groupKey}
                      speakingGroup={speakingGroup}
                      onPress={() => speakSequence([v.word], groupKey)}
                    />
                  </View>
                )
              })}
            </View>
          )}
```

No new imports; `SpeakButton`, `speakingGroup`, and `speakSequence` are already in scope elsewhere in the same file (used for the kun/on reading groups at lines ~285 and ~305).

- [ ] **Step 2: Typecheck**

Run:
```
cd apps/mobile && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/study/KanjiCard.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): speak icons on study-card reveal vocab rows

Parity gap from B124: the kanji details page (/kanji/[id]) has speak
icons on every vocab row (commit dd6c5f7), but the study-card reveal
panel in KanjiCard.tsx only had them on the kun/on reading groups,
not on vocab rows. Adds a <SpeakButton> per vocab row using the
existing SpeakButton component and speakSequence helper already in
scope for the kun/on groups. groupKey = vocab-{i} so the
speakingGroup state highlights only the active row.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 8: Mobile — `KanjiDetail` type + `formatGrade` helper

**Files:**
- Modify: `apps/mobile/app/kanji/[id].tsx` (type extension + new helper)

- [ ] **Step 1: Extend the `KanjiDetail` interface**

Open `apps/mobile/app/kanji/[id].tsx`. Locate the `KanjiDetail` interface (around line 44). The Cross-reference codes block currently ends with `morohashiPage`. Append the three new optional fields:

```ts
interface KanjiDetail {
  id: number
  character: string
  jlptLevel: string
  strokeCount: number
  meanings: string[]
  kunReadings: string[]
  onReadings: string[]
  exampleVocab: VocabExample[]
  exampleSentences: { ja: string; en: string; vocab: string }[]
  radicals: string[]
  svgPath: string | null
  // Cross-reference codes
  jisCode: string | null
  nelsonClassic: number | null
  nelsonNew: number | null
  morohashiIndex: number | null
  morohashiVolume: number | null
  morohashiPage: number | null
  grade: number | null
  frequencyRank: number | null
  hadamitzkySpahn: number | null
  // SRS progress
  srsStatus: SrsStatus
  srsInterval: number | null
  srsRepetitions: number | null
  srsNextReviewAt: string | null
  srsLastReviewedAt: string | null
  srsEaseFactor: number | null
  srsReadingStage: number | null
}
```

- [ ] **Step 2: Add the `formatGrade` helper**

Locate the existing `formatNextReview` helper (around line 99). Directly below it, add:

```ts
/** Map Kanjidic2 <grade> values to a human label.
 *  1–6 = Kyōiku (elementary); 8 = JHS-only Jōyō; 9/10 = Jinmeiyō (name-use).
 *  Grade 7 does not exist in the DTD. */
function formatGrade(g: number): string {
  if (g >= 1 && g <= 6) return `${g}`
  if (g === 8) return 'Junior High'
  if (g === 9 || g === 10) return 'Jinmeiyō'
  return `${g}`
}
```

- [ ] **Step 3: Typecheck**

Run:
```
cd apps/mobile && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add 'apps/mobile/app/kanji/[id].tsx'
git commit -m "$(cat <<'EOF'
feat(mobile): KanjiDetail type + formatGrade for Kanjidic2 refs

Extends KanjiDetail with grade / frequencyRank / hadamitzkySpahn
(nullable). Adds formatGrade(g) helper mapping Kanjidic2 grade values
to display labels: 1–6 show the digit, 8 = 'Junior High', 9/10 =
'Jinmeiyō'. Rendering of these fields lands in the next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 9: Mobile — render Kanjidic2 refs in Cross-references block

**Files:**
- Modify: `apps/mobile/app/kanji/[id].tsx` around line 499

- [ ] **Step 1: Extend the guard condition and add three RefRow entries**

Locate the Cross-references block (around line 499). Current code:

```tsx
          {/* Cross-references */}
          {(kanji.nelsonClassic != null || kanji.nelsonNew != null || kanji.morohashiIndex != null || kanji.jisCode != null) && (
            <Card title="Cross-references">
              {kanji.jisCode != null && <RefRow label="JIS Code" value={kanji.jisCode} />}
              {kanji.nelsonClassic != null && <RefRow label="Nelson Classic" value={`#${kanji.nelsonClassic}`} onPress={() => Linking.openURL(`https://jisho.org/search/${encodeURIComponent(kanji.character)}%23kanji`)} />}
              {kanji.nelsonNew != null && <RefRow label="New Nelson" value={`#${kanji.nelsonNew}`} onPress={() => Linking.openURL(`https://jisho.org/search/${encodeURIComponent(kanji.character)}%23kanji`)} />}
```

Replace the block's opening guard + the first few RefRow lines so the full block reads:

```tsx
          {/* Cross-references */}
          {(kanji.nelsonClassic != null
            || kanji.nelsonNew != null
            || kanji.morohashiIndex != null
            || kanji.jisCode != null
            || kanji.grade != null
            || kanji.frequencyRank != null
            || kanji.hadamitzkySpahn != null) && (
            <Card title="Cross-references">
              {kanji.jisCode != null && <RefRow label="JIS Code" value={kanji.jisCode} />}
              {kanji.grade != null && <RefRow label="Kyōiku Grade" value={formatGrade(kanji.grade)} />}
              {kanji.frequencyRank != null && <RefRow label="Frequency" value={`#${kanji.frequencyRank} of ~2500`} />}
              {kanji.nelsonClassic != null && <RefRow label="Nelson Classic" value={`#${kanji.nelsonClassic}`} onPress={() => Linking.openURL(`https://jisho.org/search/${encodeURIComponent(kanji.character)}%23kanji`)} />}
              {kanji.nelsonNew != null && <RefRow label="New Nelson" value={`#${kanji.nelsonNew}`} onPress={() => Linking.openURL(`https://jisho.org/search/${encodeURIComponent(kanji.character)}%23kanji`)} />}
              {kanji.hadamitzkySpahn != null && <RefRow label="Hadamitzky-Spahn" value={`#${kanji.hadamitzkySpahn}`} />}
```

(The existing Morohashi row follows and stays as-is. Do not delete any existing rows.)

- [ ] **Step 2: Typecheck**

Run:
```
cd apps/mobile && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 3: Run the mobile test suite**

Run:
```
cd apps/mobile && pnpm exec jest
```
Expected: all prior passes plus the 10 `SessionComplete.messaging` tests from Task 3 — 22+ tests total, all green.

- [ ] **Step 4: Commit**

```bash
git add 'apps/mobile/app/kanji/[id].tsx'
git commit -m "$(cat <<'EOF'
feat(mobile): surface Kyōiku grade + frequency + Hadamitzky-Spahn on details page

Adds three RefRow entries to the Cross-references card: Kyōiku Grade
(formatted via formatGrade), Frequency (#N of ~2500), and
Hadamitzky-Spahn (#N). Data was populated in Phase 2 (migration 0019 +
seed-kanjidic-refs) but never surfaced through the UI. Ordering
groups learner-oriented codes (JIS, grade, frequency) near the top
and scholarly-lookup codes (Nelson, Hadamitzky, Morohashi) below.
Guard condition extended so the card renders when only the new
fields are present.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 10: Tracker updates (BUGS.md + ENHANCEMENTS.md)

**Files:**
- Modify: `BUGS.md`
- Modify: `ENHANCEMENTS.md`

- [ ] **Step 1: Add a Fixed entry for the flash-race bug in BUGS.md**

Open `BUGS.md`. Find a natural insertion point near other 2026-04-20 entries (e.g. near the "Study queue re-surfaces 20 cards" entry at line ~102). Add directly below it:

```markdown
- [x] **"All caught up!" empty state flashes briefly before the review queue loads** — ~~FIXED~~ 2026-04-20 in B126. `review.store.ts` initial state had `isLoading: false`, so `study.tsx`'s empty-state branch (guarded by `!isLoading && queue.length === 0`) rendered for one frame on cold mount before the effect fired `loadQueue`. Observed during B125 verification as a ~2s "All caught up!" flash between back-to-back sessions. Fix: initial `isLoading: true` — empty state now only renders when `loadQueue` genuinely returns zero.

  `[Effort: XS]` `[Impact: Low]` `[Status: ✅ Fixed]`
```

- [ ] **Step 2: Add Shipped entries to ENHANCEMENTS.md**

Open `ENHANCEMENTS.md`. Find the neighbourhood of other recently-shipped mobile UX entries (e.g. near the Session Complete rebalance entry we added earlier today). Add four new entries — keep them grouped:

```markdown
- [x] **Daily-goal progress indicator + celebration banner** — ~~SHIPPED~~ 2026-04-20 in B126. Dashboard now shows `N / M today` under the Start Today's Reviews CTA with a success checkmark when the goal is met. SessionComplete renders a 🎉 'Daily goal met' banner on the session that crosses the threshold for the first time each day (suppressed when burned > 0). No daily cap; soft target only. Deliberate design choice per the brainstorm: keep unlimited same-day review for motivated learners; the pedagogical gate belongs to the future Three-Modality Learning Loop.
  `[Effort: S]` `[Impact: Med]` `[Backend: No]` `[Status: ✅ Shipped]`

- [x] **Study-card reveal vocab rows — speak icons (parity with details page)** — ~~SHIPPED~~ 2026-04-20 in B126. Closes the gap where B124's speak-icon work touched the details page but missed KanjiCard.tsx's reveal panel. Reuses the existing SpeakButton + speakSequence machinery already in scope for the kun/on reading groups.
  `[Effort: XS]` `[Impact: Low]` `[Backend: No]` `[Status: ✅ Shipped]`

- [x] **Kanjidic2 reference codes surfaced on kanji details page** — ~~SHIPPED~~ 2026-04-20 in B126. Phase 2 migration 0019 + seed-kanjidic-refs populated `grade` (99.2% of corpus), `frequency_rank` (93.8%), and `hadamitzky_spahn` (98.3%) back on 2026-04-20, but neither the API nor the mobile UI surfaced the data. API now includes the three fields in `/v1/kanji/:id`; mobile details page renders Kyōiku Grade, Frequency, and Hadamitzky-Spahn rows in the Cross-references card (alongside JIS, Nelson, Morohashi).
  `[Effort: S]` `[Impact: Med]` `[Backend: Yes]` `[Status: ✅ Shipped]`
```

- [ ] **Step 3: Commit the tracker updates**

```bash
git add BUGS.md ENHANCEMENTS.md
git commit -m "$(cat <<'EOF'
docs: log B126 fixes in trackers (flash race + 3 shipped enhancements)

BUGS.md: adds a Fixed entry for the 'All caught up!' flash-race bug
(distinct from the earlier a9c91fd dailyGoal-race fix; different
root cause — review store initial isLoading).

ENHANCEMENTS.md: adds Shipped entries for:
- Daily-goal progress indicator + celebration banner
- Study-card reveal vocab speak icons (parity with details page)
- Kanjidic2 reference codes on kanji details page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 11: Cut B126 EAS build

**Files:** none (build action)

- [ ] **Step 1: Final pre-build typecheck + test sweep**

Run from repo root:
```
cd apps/mobile && pnpm typecheck && pnpm exec jest
```
Expected: typecheck clean, all tests pass (≥22 mobile tests).

- [ ] **Step 2: Kick off the EAS build with auto-submit**

Run from repo root:
```
cd apps/mobile && eas build --platform ios --auto-submit --non-interactive --no-wait
```

Expected output includes:
- `Bumping expo.ios.buildNumber from 125 to 126`
- A new `Build ID:` (record it for the HANDOFF update)
- `Scheduled iOS submission` line with a submission ID

- [ ] **Step 3: Record the build ID + submission ID**

Note both IDs from Step 2's output. They'll be linked in the HANDOFF update at the end of the B126 execution.

- [ ] **Step 4: Update HANDOFF.md with the B126 in-flight status**

The HANDOFF pattern established in this session: after each EAS build is submitted, add a short section to `docs/HANDOFF.md` with the build ID, submission ID, and a summary of what's in the build. Use the B125 section as the template.

- [ ] **Step 5: Commit HANDOFF update**

```bash
git add docs/HANDOFF.md
git commit -m "$(cat <<'EOF'
docs(handoff): B126 EAS build submitted

B126 bundles five UX polish changes:
1. Daily-goal progress indicator on Dashboard
2. Goal celebration banner in SessionComplete
3. 'All caught up!' flash-race fix
4. Speak icons on study-card reveal vocab rows
5. Kanjidic2 reference codes surfaced on kanji details page

Plus the earlier PitchAccentReading contrast fix (a704ad2).

Requires an API deploy (Task 2) which ships the /v1/kanji/:id field
extension that section 5 depends on.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Self-review summary

- **Spec coverage:** Every section of the spec maps to a task.
  - Spec §1 (Dashboard progress indicator) → Task 6.
  - Spec §2 (Goal celebration) → Tasks 3 + 5.
  - Spec §3 (Flash-race fix) → Task 4.
  - Spec §4 (Study-card vocab speak icons) → Task 7.
  - Spec §5 (Kanjidic2 refs) → Tasks 1, 2, 8, 9.
  - Rollout / trackers → Tasks 10 + 11.
- **Placeholder scan:** No TBD / "implement later" / "similar to Task N" patterns. Each step has exact file paths, complete code, and the commands to verify.
- **Type consistency:** `didCrossGoal(reviewedBefore, totalItems, dailyGoal)` signature is identical in the test (Task 3), implementation (Task 3), and caller (Task 5). `reviewedBefore` + `dailyGoal` on the SessionComplete Props match the fields written into `sessionSummary` state in study.tsx (Task 5). `grade: number | null`, `frequencyRank: number | null`, `hadamitzkySpahn: number | null` on the KanjiDetail mobile type (Task 8) mirror the Drizzle schema columns' nullable types and the API SELECT's emission (Task 1). `formatGrade(g: number): string` signature matches its sole call site in Task 9.

---

## Execution Handoff

Plan complete and saved to [docs/superpowers/plans/2026-04-20-b126-ux-polish-bundle.md](2026-04-20-b126-ux-polish-bundle.md). Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks. Each task is self-contained which makes this pattern fast. Main advantage: cleaner context windows per task, particularly useful for Task 5 which touches two files.

2. **Inline Execution (simpler for this size)** — Execute tasks in this session using executing-plans. Small plan; 11 tasks each ≤5 minutes; one checkpoint after Task 2 (API deploy lands) and one after Task 9 (all code in) is sufficient.

Which approach?
