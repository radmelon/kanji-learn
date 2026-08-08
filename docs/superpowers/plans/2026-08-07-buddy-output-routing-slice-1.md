# Buddy Output Routing — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Journal the complete, uncapped ledger of coaching findings, and land the routing table that later slices consume — without changing novelty behaviour or adding any new surface.

**Architecture:** A pure routing table in `packages/shared/src/coaching/routing.ts` declares, per finding kind, which *event* surfaces it may reach and which *audiences* may see it. Nothing consumes it yet. Separately, `CoachingService.refresh` starts writing **all** firing findings to the notebook entry while continuing to stamp novelty on only the top-`DEFAULT_FINDING_COUNT` subset — the "spoken set" of spec §8.1.

**Tech Stack:** TypeScript, vitest (shared + api), Drizzle, Fastify. No mobile changes. No migration. No new endpoint.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-07-buddy-output-routing-design.md`. Read §4, §8 and §8.1 before starting.
- **The stamped set is NEVER the full Journal write, at any slice** (spec §8.1). `carryForward` and `selectionsMatch` keep receiving the top-`DEFAULT_FINDING_COUNT` subset in this slice.
- **No event surface ships in this slice.** `routing.ts` is written, exported and tested, and has zero runtime consumers when this slice merges. That is intentional, not an oversight.
- **Detectors are pure and read no clock.** `packages/shared/src/coaching/analyze.test.ts` greps this directory's raw source — *comments included* — for `Date.now()` and `new Date()`. Do not write either into any file under `packages/shared/src/coaching/`, even inside a comment.
- **Rationale lives on the row, not only in the spec** (spec §4.1). The four rows named in Task 2 must carry their reasoning as comments in `routing.ts`.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- Run all commands from the repo root: `/Volumes/DockM2/projects/kanji-learn`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/coaching/routing.ts` | **Create.** The routing table, its types, per-surface caps. Pure data + two small pure functions. No imports from `apps/`. |
| `packages/shared/src/coaching/routing.test.ts` | **Create.** Exhaustiveness, audience filtering, cap lookup. |
| `packages/shared/src/coaching/index.ts` | **Modify.** Re-export `./routing`. |
| `apps/api/src/services/buddy/coaching.service.ts` | **Modify** (~line 182 and ~line 196). Write all findings to the Journal; keep stamping the top-N subset. |
| `apps/api/test/integration/coaching-refresh.test.ts` | **Modify.** Add the uncapped-body and spoken-set assertions, plus a `manyFindings()` fixture. **Not** `coaching-notebook-store.test.ts` — that one tests `NotebookService` storage and never constructs a `CoachingService`. |

`routing.ts` is deliberately separate from `selection.ts`: selection answers *"which findings are most worth saying"*, routing answers *"where may this kind be said, and to whom"*. Merging them would put the thing this project could not previously point at back inside a file that already does something else.

---

## Task 1: The `Surface` and `Audience` vocabulary

**Files:**
- Create: `packages/shared/src/coaching/routing.ts`
- Test: `packages/shared/src/coaching/routing.test.ts`

**Interfaces:**
- Consumes: `FindingKind` from `./types`
- Produces: `type Surface`, `type EventSurface`, `type RecordSurface`, `type Audience`, `EVENT_SURFACES`, `RECORD_SURFACES`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/coaching/routing.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { EVENT_SURFACES, RECORD_SURFACES } from './routing'

describe('surface vocabulary', () => {
  it('separates event surfaces from record surfaces with no overlap', () => {
    const overlap = EVENT_SURFACES.filter((s) => (RECORD_SURFACES as readonly string[]).includes(s))
    expect(overlap).toEqual([])
  })

  it('names the four event surfaces from spec §3.1', () => {
    expect([...EVENT_SURFACES].sort()).toEqual(
      ['placement', 'progress', 'session_complete', 'weekly'],
    )
  })

  it('names the two record surfaces from spec §3.1', () => {
    expect([...RECORD_SURFACES].sort()).toEqual(['journal', 'tutor_report'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kanji-learn/shared test -- routing`
Expected: FAIL — `Failed to resolve import "./routing"`

- [ ] **Step 3: Write minimal implementation**

Create `packages/shared/src/coaching/routing.ts`:

```ts
import type { FindingKind } from './types'

/**
 * WHERE a finding may be said, and to WHOM (spec 2026-08-07 §3, §4).
 *
 * This file exists because nobody owned placement. The coaching design's §12
 * slices the work six ways and none of them asks whether the notebook is the
 * right destination for a given finding, so everything landed in one tab on one
 * cadence by default. A literal table is the artifact that fixes that: greppable,
 * diffable, reviewable in one screen.
 *
 * Kept separate from `selection.ts` on purpose. Selection answers "which findings
 * are most worth saying"; routing answers "where may this kind be said, and to
 * whom". Merging them would put the thing this project could not previously point
 * at back inside a file that already does something else.
 */

/**
 * Opened on purpose by someone who wants the complete picture. Uncapped, does not
 * rotate, and NEVER burns novelty (§8). Capping or rotating one is a category
 * error.
 */
export const RECORD_SURFACES = ['journal', 'tutor_report'] as const
export type RecordSurface = typeof RECORD_SURFACES[number]

/**
 * Interrupts a moment. Shows few things, rotates so the same sentence does not
 * follow the learner around, and speaks a given finding at most once per analysis
 * cycle (§6).
 */
export const EVENT_SURFACES = ['placement', 'session_complete', 'progress', 'weekly'] as const
export type EventSurface = typeof EVENT_SURFACES[number]

export type Surface = RecordSurface | EventSurface

/** Who is reading. The tutor report is the only non-learner reader (§3.2). */
export type Audience = 'learner' | 'tutor'
```

⚠️ **Do not re-export `FindingKind` from this file.** `coaching/index.ts` already
does `export * from './types'`, and adding `export * from './routing'` in Task 3
would then export the same name twice — an ambiguous re-export. Import it, use it,
do not forward it.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @kanji-learn/shared test -- routing`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/coaching/routing.ts packages/shared/src/coaching/routing.test.ts
git commit -m "$(cat <<'EOF'
feat(coaching): the surface and audience vocabulary for output routing

Record surfaces are opened on purpose and want completeness; event
surfaces interrupt a moment and want brevity. Naming the two types turns
"should this surface be capped?" from a per-surface guess into a property
of the type.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: The routing table

**Files:**
- Modify: `packages/shared/src/coaching/routing.ts`
- Test: `packages/shared/src/coaching/routing.test.ts`

**Interfaces:**
- Consumes: `Surface`, `EventSurface`, `Audience` from Task 1; `FindingKind`, `FINDING_PRIORITY` from `./types`
- Produces: `interface RoutingRule { anchor: string; events: readonly EventSurface[]; audiences: readonly Audience[] }`, `const ROUTING: Record<FindingKind, RoutingRule>`

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/coaching/routing.test.ts`:

```ts
import { ROUTING } from './routing'
import { FINDING_PRIORITY } from './types'

describe('the routing table', () => {
  it('covers every finding kind', () => {
    expect(Object.keys(ROUTING).sort()).toEqual(Object.keys(FINDING_PRIORITY).sort())
  })

  it('gives every kind at least one event surface', () => {
    const orphans = Object.entries(ROUTING)
      .filter(([, rule]) => rule.events.length === 0)
      .map(([kind]) => kind)
    expect(orphans).toEqual([])
  })

  it('gives every kind at least one audience', () => {
    const mute = Object.entries(ROUTING)
      .filter(([, rule]) => rule.audiences.length === 0)
      .map(([kind]) => kind)
    expect(mute).toEqual([])
  })

  it('records a non-empty anchor rationale on every row', () => {
    for (const [kind, rule] of Object.entries(ROUTING)) {
      expect(rule.anchor.length, `${kind} has no anchor`).toBeGreaterThan(0)
    }
  })

  it('routes only to surfaces that exist', () => {
    for (const [kind, rule] of Object.entries(ROUTING)) {
      for (const s of rule.events) {
        expect(EVENT_SURFACES, `${kind} routes to unknown surface ${s}`).toContain(s)
      }
    }
  })

  // Spec §3.2 — two kinds are learner-only for DIFFERENT reasons, and the spec
  // is explicit that revisiting the consent call must move only commitment_gap.
  it('withholds mechanics_explainer from tutors — its subject is the app', () => {
    expect(ROUTING.mechanics_explainer.audiences).toEqual(['learner'])
  })

  it('withholds commitment_gap from tutors — consent, not subject', () => {
    expect(ROUTING.commitment_gap.audiences).toEqual(['learner'])
  })

  it('shares every other kind with tutors', () => {
    const shared = Object.entries(ROUTING)
      .filter(([kind]) => kind !== 'mechanics_explainer' && kind !== 'commitment_gap')
    for (const [kind, rule] of shared) {
      expect(rule.audiences, `${kind} should be tutor-visible`).toContain('tutor')
    }
  })

  // Spec §4.1 — commitment_gap is barred from Session Complete on purpose.
  it('never routes commitment_gap to Session Complete', () => {
    expect(ROUTING.commitment_gap.events).not.toContain('session_complete')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kanji-learn/shared test -- routing`
Expected: FAIL — `ROUTING` is not exported

- [ ] **Step 3: Write minimal implementation**

Append to `packages/shared/src/coaching/routing.ts`:

```ts
export interface RoutingRule {
  /**
   * WHY this row is set the way it is. Not read by any code. It exists so that
   * changing a row means arguing with the reason it was set (spec §4).
   */
  anchor: string
  /** Event surfaces this kind may be spoken on. The Journal is not listed —
   *  every finding goes to every record surface its audience allows. */
  events: readonly EventSurface[]
  audiences: readonly Audience[]
}

const LEARNER_AND_TUTOR = ['learner', 'tutor'] as const
const LEARNER_ONLY = ['learner'] as const

/**
 * Exhaustive by construction: `Record<FindingKind, …>` means a new finding kind
 * will not compile until somebody decides where it goes. That is the single most
 * valuable guarantee in this file, because the failure it exists to fix is a kind
 * quietly having no home.
 */
export const ROUTING: Record<FindingKind, RoutingRule> = {
  level_estimate: {
    anchor: 'event — the test just taken; stays true until the next one',
    // Progress carries the Velocity panel, which projects trajectory and ETA, so
    // a current level is progress-adjacent. "Where am I" and "how long until X"
    // are one question currently answered on two screens (spec §12.1).
    events: ['placement', 'progress'],
    audiences: LEARNER_AND_TUTOR,
  },
  hardest_cleared: {
    anchor: 'event — worthless a week later',
    events: ['placement'],
    audiences: LEARNER_AND_TUTOR,
  },
  mechanics_explainer: {
    anchor: 'event — explains the test you just took',
    // Moving this to placement fixes something live. On 2026-08-07 it WON a
    // Journal slot against leech — a static explainer that never changes
    // displacing a diagnostic naming 23 struggling kanji — because it had never
    // been raised so its novelty was 1.0. It explains the placement test; it
    // belongs at the placement test, not competing with live diagnostics.
    events: ['placement'],
    // LEARNER-ONLY because its SUBJECT is the app rather than the learner. A
    // tutor does not need Buddy explaining the tool to them. This is NOT the
    // same reason as commitment_gap below — do not collapse the two.
    audiences: LEARNER_ONLY,
  },
  theta_delta: {
    anchor: 'event — only new at the second test',
    events: ['placement'],
    audiences: LEARNER_AND_TUTOR,
  },
  retest_due: {
    anchor: 'record — a standing drift',
    events: ['progress'],
    audiences: LEARNER_AND_TUTOR,
  },
  reading_lag: {
    anchor: 'record — a standing imbalance',
    events: ['progress'],
    audiences: LEARNER_AND_TUTOR,
  },
  leech: {
    anchor: 'record — but actionable right after a lapse',
    events: ['session_complete', 'progress'],
    audiences: LEARNER_AND_TUTOR,
  },
  hook_coverage: {
    anchor: 'event — you just missed it',
    // NOT an invention: study.tsx records that the co-creation offer was
    // deliberately moved out of mid-card and to Session Complete (parent spec
    // §4.1), because interrupting retrieval to offer a hook damages the
    // retrieval. Routing the finding that MOTIVATES a hook to the same place the
    // offer already lands is consistency with a decision already paid for.
    events: ['session_complete'],
    audiences: LEARNER_AND_TUTOR,
  },
  fluency_gain: {
    anchor: 'event — praise about the session just finished',
    events: ['session_complete'],
    audiences: LEARNER_AND_TUTOR,
  },
  commitment_gap: {
    anchor: 'record — a period, not a moment',
    // Barred from session_complete ON PURPOSE. Telling someone who has just
    // finished studying that they studied less than they promised is the wrong
    // instrument at the wrong moment. It is period-anchored: the weekly session
    // is where the period is reviewed.
    events: ['weekly', 'progress'],
    // LEARNER-ONLY on CONSENT grounds, not subject grounds. A learner sharing
    // progress with a tutor did not obviously authorise Buddy reporting on their
    // diligence. If that call is ever revisited, THIS row moves and
    // mechanics_explainer does not.
    audiences: LEARNER_ONLY,
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @kanji-learn/shared test -- routing`
Expected: PASS, 11 tests

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/coaching/routing.ts packages/shared/src/coaching/routing.test.ts
git commit -m "$(cat <<'EOF'
feat(coaching): the routing table — which finding reaches which surface

Ten rows, exhaustive over FindingKind by construction, so a new kind will
not compile until somebody decides where it goes.

Four rows carry their reasoning as comments because they are the ones a
future reader is most likely to change without knowing what they are
undoing: hook_coverage follows a precedent study.tsx already set,
commitment_gap is barred from Session Complete on purpose,
mechanics_explainer moving to placement stops a static explainer beating
live diagnostics for a slot, and the two learner-only rows are
learner-only for different reasons that must not be collapsed.

Nothing consumes this yet. That is intentional.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Per-surface caps and the routing helpers

**Files:**
- Modify: `packages/shared/src/coaching/routing.ts`
- Test: `packages/shared/src/coaching/routing.test.ts`

**Interfaces:**
- Consumes: `ROUTING`, `Surface`, `EventSurface`, `Audience` from Tasks 1–2; `Finding` from `./types`
- Produces:
  - `const SURFACE_CAP: Record<Surface, number>` — `Infinity` for record surfaces
  - `function routableTo(findings: readonly Finding[], surface: Surface, audience: Audience): Finding[]`

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/coaching/routing.test.ts`:

```ts
import { SURFACE_CAP, routableTo } from './routing'
import type { Finding, FindingKind } from './types'

function f(kind: FindingKind): Finding {
  return { kind, magnitude: 0.5, confidence: 1, evidence: [], since: null }
}

describe('per-surface caps', () => {
  it('leaves record surfaces uncapped — they are the ledger', () => {
    expect(SURFACE_CAP.journal).toBe(Infinity)
    expect(SURFACE_CAP.tutor_report).toBe(Infinity)
  })

  it('caps Session Complete at one — the learner is leaving', () => {
    expect(SURFACE_CAP.session_complete).toBe(1)
  })

  it('caps placement at three', () => {
    expect(SURFACE_CAP.placement).toBe(3)
  })
})

describe('routableTo', () => {
  it('keeps only kinds the table routes to that event surface', () => {
    const out = routableTo([f('hardest_cleared'), f('leech')], 'placement', 'learner')
    expect(out.map((x) => x.kind)).toEqual(['hardest_cleared'])
  })

  it('sends every audience-permitted kind to a record surface', () => {
    const out = routableTo([f('hardest_cleared'), f('leech')], 'journal', 'learner')
    expect(out.map((x) => x.kind).sort()).toEqual(['hardest_cleared', 'leech'])
  })

  it('withholds learner-only kinds from a tutor even on a record surface', () => {
    const out = routableTo(
      [f('commitment_gap'), f('mechanics_explainer'), f('leech')],
      'tutor_report',
      'tutor',
    )
    expect(out.map((x) => x.kind)).toEqual(['leech'])
  })

  it('preserves input order — selection already ranked these', () => {
    const out = routableTo([f('leech'), f('reading_lag')], 'progress', 'learner')
    expect(out.map((x) => x.kind)).toEqual(['leech', 'reading_lag'])
  })

  it('does not apply the cap — that is the caller\'s decision', () => {
    const out = routableTo([f('leech'), f('hook_coverage')], 'session_complete', 'learner')
    expect(out).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kanji-learn/shared test -- routing`
Expected: FAIL — `SURFACE_CAP` is not exported

- [ ] **Step 3: Write minimal implementation**

First widen the **existing** type import at the top of
`packages/shared/src/coaching/routing.ts` — do not add a second import statement
mid-file:

```ts
import type { Finding, FindingKind } from './types'
```

Then append:

```ts
/**
 * Replaces the global DEFAULT_FINDING_COUNT as the answer to "how many".
 *
 * That constant was never a content decision — it was a PLACEMENT decision made
 * by default, because one entry in one tab was the only surface that existed. On
 * 2026-08-07 a live render showed 7 of 10 kinds firing and 3 reaching the
 * learner: reading_lag and retest_due had been shipped-but-unread for weeks.
 */
export const SURFACE_CAP: Record<Surface, number> = {
  // The ledger. Uncapping this is what ends the silent 7-of-10 loss.
  journal: Infinity,
  // A record surface; a tutor wants the complete picture.
  tutor_report: Infinity,
  // Four kinds are eligible, but theta_delta only fires on a retest.
  placement: 3,
  // The learner is leaving. One sentence or none.
  session_complete: 1,
  // Browsing, not transiting. A guess, to be tuned against real sessions.
  progress: 2,
  // Eligibility-filtered, not cap-limited: the table constrains WHICH findings
  // the weekly session may speak, and slice 3's analysis mode keeps owning how
  // many it speaks and how it words them (spec §7.1).
  weekly: Infinity,
}

function isRecordSurface(s: Surface): s is RecordSurface {
  return (RECORD_SURFACES as readonly string[]).includes(s)
}

/**
 * Findings this surface may show this audience. Order is preserved — `select()`
 * has already ranked them and this must not reorder that.
 *
 * Does NOT apply SURFACE_CAP. Slicing is the caller's job, because the caller is
 * the one that knows whether it is writing a record (uncapped) or speaking on an
 * event surface (capped, and subject to the once-per-cycle rule).
 */
export function routableTo(
  findings: readonly Finding[],
  surface: Surface,
  audience: Audience,
): Finding[] {
  return findings.filter((f) => {
    const rule = ROUTING[f.kind]
    if (!rule.audiences.includes(audience)) return false
    // Every finding goes to every record surface its audience allows; the table
    // enumerates event surfaces only.
    if (isRecordSurface(surface)) return true
    return (rule.events as readonly string[]).includes(surface)
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @kanji-learn/shared test -- routing`
Expected: PASS, 19 tests

- [ ] **Step 5: Export from the package index**

Modify `packages/shared/src/coaching/index.ts` — add after the `./selection` line:

```ts
export * from './routing'
```

- [ ] **Step 6: Verify the whole shared suite still passes**

Run: `pnpm --filter @kanji-learn/shared test`
Expected: PASS. **Watch for `analyze.test.ts > purity`** — it greps this directory's raw source, comments included, for clock reads. If it fails, a comment contains the literal `Date.now()` or `new Date()`; rephrase the prose.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/coaching/routing.ts packages/shared/src/coaching/routing.test.ts packages/shared/src/coaching/index.ts
git commit -m "$(cat <<'EOF'
feat(coaching): per-surface caps and the routing filter

DEFAULT_FINDING_COUNT stops being the global answer to "how many". It was
never a content decision — it was a placement decision made by default,
because one entry in one tab was the only surface that existed.

routableTo deliberately does not apply the cap. Slicing belongs to the
caller, which is the only party that knows whether it is writing a record
or speaking on an event surface.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: The Journal becomes the uncapped ledger

**Files:**
- Modify: `apps/api/src/services/buddy/coaching.service.ts` (the `refresh` method, around lines 181–196 and 210)
- Test: `apps/api/test/integration/coaching-refresh.test.ts`

⚠️ **The test goes in `coaching-refresh.test.ts`, not `coaching-notebook-store.test.ts`.**
The latter exercises `NotebookService` storage round-tripping and has no
`CoachingService` at all. `coaching-refresh.test.ts` already builds
`new CoachingService(db)`, fixes `NOW = '2026-08-02T12:00:00.000Z'`, and owns
`USER = '00000000-0000-0000-0000-0000000000c6'` with a `wipe()` that clears
`notebook_entries`, `buddy_commitments` and `daily_stats`.

**Interfaces:**
- Consumes: `analyze` from `@kanji-learn/shared`; `FINDING_PRIORITY` for the kind count; `DEFAULT_FINDING_COUNT` for the spoken-set size
- Produces: no new exports. The notebook entry body now contains all firing findings; `source.findings` still contains only the spoken set.

**⚠️ Read spec §8.1 before this task.** The whole risk here is stamping novelty on the full write. Do not.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/test/integration/coaching-refresh.test.ts`, inside the existing
`describe('CoachingService.refresh', …)` block so it inherits `service`,
`notebook`, `USER`, `NOW` and `wipe()`.

First add a fixture helper next to the existing `missedPeriod()` at the top of the
file. `missedPeriod()` alone fires `commitment_gap`; the placement rows add
`level_estimate`, `mechanics_explainer` and `hardest_cleared`, which is enough to
clear three:

```ts
/**
 * A learner rich enough that MORE than DEFAULT_FINDING_COUNT kinds fire.
 * commitment_gap from the missed period; level_estimate and hardest_cleared from
 * the placement; mechanics_explainer fires on any non-null placement at all
 * (`detectors/orient.ts` — `if (!snapshot.placement) return null`, nothing more).
 */
async function manyFindings() {
  await missedPeriod()
  const rows = await db.execute(sql`INSERT INTO placement_sessions
    (user_id, ability_theta, ability_se, inferred_level, completed_at)
    VALUES (${USER}, 1.1, 0.5, 'N3', '2026-08-01T00:00:00Z') RETURNING id`)
  const sessionId = (rows[0] as any).id
  const k = await db.execute(sql`SELECT id FROM kanji ORDER BY id LIMIT 1`)
  await db.execute(sql`INSERT INTO placement_results
    (session_id, kanji_id, jlpt_level, passed, meaning_correct, reading_correct, difficulty_at_ask)
    VALUES (${sessionId}, ${Number((k[0] as any).id)}, 'N5', true, true, true, 0.9)`)
}
```

Add `placement_sessions` to the existing `wipe()` so these rows do not leak
between tests:

```ts
    await db.execute(sql`DELETE FROM placement_sessions WHERE user_id = ${USER}`)
```

Then the tests:

```ts
  it('writes EVERY firing finding to the body, not just the top three', async () => {
    await manyFindings()

    const { findings } = await service.refresh(USER, NOW)
    expect(findings.length).toBeGreaterThan(3)

    const row = await notebook.readLatestKeyed(USER, 'coaching_analysis')
    // The body is the ledger: analysisBody joins one paragraph per finding.
    const paragraphs = row!.body.split('\n\n').filter(Boolean)
    expect(paragraphs.length).toBe(findings.length)
  })

  it('still stamps novelty on only the spoken set — NOT the whole write', async () => {
    await manyFindings()

    const { findings } = await service.refresh(USER, NOW)
    const row = await notebook.readLatestKeyed(USER, 'coaching_analysis')

    // spec §8.1: the stamped set is NEVER the full Journal write, at any slice.
    // Stamping everything flattens novelty to a constant, the ranking collapses
    // to magnitude x confidence, and Session Complete would later show the same
    // sentence forever.
    expect(row!.source.findings.length).toBe(3)
    expect(row!.source.findings.length).toBeLessThan(findings.length)
  })
```

⚠️ **If `findings.length` is not greater than 3**, do not weaken the assertion.
Print what fired — `console.log(findings.map((f) => f.kind))` — and add whatever
the fixture is missing. `retest_due` also fires off placement standard error, and
`leech` needs `user_kanji_progress` rows with non-zero `lapses`. The test is
worthless if the fixture cannot exceed the old cap, because that is the exact
thing being changed.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kanji-learn/api test -- coaching-refresh`
Expected: FAIL — the first test fails with `paragraphs.length` of 3 against a larger `findings.length`.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/src/services/buddy/coaching.service.ts`, add to the `@kanji-learn/shared` import block:

```ts
  DEFAULT_FINDING_COUNT, FINDING_PRIORITY,
```

Replace line 182 (`const findings = analyze(snapshot)`) with:

```ts
    // The Journal is the LEDGER (spec §3.1): every finding that fires is written,
    // uncapped. Before this, analyze() took the top DEFAULT_FINDING_COUNT and the
    // rest were computed and discarded — a live render on 2026-08-07 found 7 of
    // 10 kinds firing and 3 reaching the learner, with reading_lag and retest_due
    // shipped-but-unread for weeks.
    const findings = analyze(snapshot, Object.keys(FINDING_PRIORITY).length)

    // ⚠️ The SPOKEN SET (spec §8.1), and the reason it is not `findings`.
    // `carryForward` stamps what was shown, and that decay is what lets an
    // unshown finding rise and eventually win a slot. Stamp the whole ledger and
    // every kind decays equally every cycle, novelty flattens to a constant, and
    // the ranking collapses to magnitude x confidence.
    //
    // `analyze` has already ranked, so slicing gives exactly what the old
    // analyze(snapshot) returned. From slice 2 this becomes "what a surface
    // actually showed"; until then it is "what the cap would have shown".
    const spoken = findings.slice(0, DEFAULT_FINDING_COUNT)
```

Replace line 196 (`findings: carryForward(priors, findings, now),`) with:

```ts
      findings: carryForward(priors, spoken, now),
```

Replace line 210 (`const unchanged = selectionsMatch(priors, findings)`) with:

```ts
    // Compares against the stamped set, which is what `priors` holds.
    const unchanged = selectionsMatch(priors, spoken)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @kanji-learn/api test -- coaching-refresh`
Expected: PASS

- [ ] **Step 5: Run the full coaching suite for regressions**

Run: `pnpm --filter @kanji-learn/api test -- coaching`
Expected: PASS, 114+ tests. `coaching-snapshot.test.ts` and `coaching-refresh.test.ts` both exercise `refresh`; if either fails on a finding count, it is asserting the old top-3 body and needs updating to the ledger semantics — not reverting.

- [ ] **Step 6: Typecheck**

Run: `cd apps/api && npx tsc --noEmit && cd ../..`
Expected: exit 0

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/buddy/coaching.service.ts apps/api/test/integration/coaching-refresh.test.ts
git commit -m "$(cat <<'EOF'
fix(coaching): the Journal becomes the complete ledger

analyze() took the top 3 and the rest were computed and discarded. A live
render on 2026-08-07 found 7 of 10 kinds firing and 3 reaching the
learner — reading_lag and retest_due had been shipped-but-unread for
weeks. That cap was never a content decision; it was a placement decision
made by default, because one entry in one tab was the only surface there
was.

The body now carries every finding that fired. Novelty stamping does NOT
follow it: carryForward and selectionsMatch keep receiving the top-N
spoken set, because stamping the whole ledger flattens novelty to a
constant and collapses the ranking to magnitude x confidence.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Verify against live data

**Files:** none modified. This task is verification only.

**Why a task and not a footnote:** this feature has ten truthfulness defects found by rendering against live data and zero found by tests. A green suite is not evidence here.

- [ ] **Step 1: Render the current live state**

Run:

```bash
./scripts/with-live-db.sh node \
  --import ./packages/db/node_modules/tsx/dist/esm/index.cjs \
  scripts/coaching-smoke-render.mjs
```

Expected: the coverage block still reports 7 of 10 kinds rendering, 3 silent. This script calls `analyze` directly and bypasses `refresh`, so **its output should be unchanged by this slice** — it is the control.

- [ ] **Step 2: Confirm the ledger actually widened, read-only**

Run:

```bash
./scripts/with-live-db.sh psql -X -q -c "
SELECT created_at,
       array_length(string_to_array(body, E'\n\n'), 1) AS paragraphs,
       jsonb_array_length(source->'findings') AS stamped
  FROM notebook_entries
 WHERE source->>'kind' = 'coaching_analysis'
 ORDER BY created_at DESC LIMIT 5;"
```

Expected on rows written **before** this slice: `paragraphs` = `stamped` = 3.
Expected on any row written **after** it: `paragraphs` > 3 while `stamped` = 3.

⚠️ **No new row appears until a learner opens the Journal and the newest entry is more than `ANALYSIS_STALE_HOURS = 6` old.** A deploy rewrites no rows. Do not read an unchanged pre-slice row as a failed rollout — that exact misreading is documented in `docs/SOP.md`.

- [ ] **Step 3: Read one new entry end to end**

Once a post-slice row exists, read its `body` in full and check each sentence against the evidence in `source`. The four kinds that were previously losing the cut — `reading_lag`, `retest_due`, `leech`, `hook_coverage` — have now reached a learner-visible surface for the first time in weeks. **Their copy has never been read in production.**

- [ ] **Step 4: Record the result**

Append a short section to `docs/HANDOFF.md` under a new dated heading: what the render showed, and whether any new-to-production sentence read wrong. If a defect is found, file it in `BUGS.md` rather than fixing it inside this slice.

- [ ] **Step 5: Commit**

```bash
git add docs/HANDOFF.md
git commit -m "$(cat <<'EOF'
docs(handoff): slice 1 verified against live data

Four kinds that had been losing the top-3 cut now reach the Journal.
Their copy had never been read in production.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Definition of Done

- [ ] `routing.ts` exports `ROUTING`, `SURFACE_CAP`, `routableTo`, and the surface/audience types
- [ ] `Record<FindingKind, RoutingRule>` compiles — adding a kind to `FindingKind` breaks the build until routed
- [ ] The four spec §4.1 rows carry their reasoning as comments **in `routing.ts`**
- [ ] `pnpm --filter @kanji-learn/shared test` passes, including `analyze.test.ts > purity`
- [ ] `pnpm --filter @kanji-learn/api test -- coaching` passes
- [ ] `cd apps/api && npx tsc --noEmit` exits 0
- [ ] The notebook body contains every firing finding; `source.findings` contains at most `DEFAULT_FINDING_COUNT`
- [ ] A post-slice notebook entry has been read end to end against live data
- [ ] **No event surface, endpoint, mobile change or migration is in this slice**

## Out of scope for this slice

Slices 2–4 of spec §11: the `/v1/buddy/findings` endpoint, the §5.2 refresh rule, placement completion, Session Complete, the Progress card stack, and the tutor report prompt section. **B-235** (`leech` ranking by a lifetime counter) is a detector defect and is fixed separately — do not fold it in here, and expect `leech` to name a possibly-stale kanji in Step 3 until it is fixed.
