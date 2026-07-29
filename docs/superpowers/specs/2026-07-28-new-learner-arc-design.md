# The New Learner Arc — design

**Canonical URL — hand this to a new session:**
https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-07-28-new-learner-arc-design.md

Owner brainstorm, 2026-07-28. Implements the first slice of **Buddy Phase 3 —
Study Orchestration Engine**, which the parent design named but never spec'd.

Parent: [`2026-04-09-kanji-buddy-design.md`](2026-04-09-kanji-buddy-design.md)
§5 (Learning Loop), §6 (Adaptive Scaffolding), §10 (Social Learning), §14
(Implementation Phasing).

---

## 1. Why this, why now

The owner asked for *"a complete build where Buddy the tutor has a complete
presence, fully enabled with data, to begin a long and evolving journey with new
students: focused on the prize but mindful of the smaller rewards of the journey
itself."*

Exploring that request produced the finding that shaped this spec: **the plan
already exists, and the phases were built out of order.**

| Phase | | Status 2026-07-28 |
|---|---|---|
| 0 | Foundation | ✅ shipped |
| 1′ | Template Buddy nudges | ✅ B136 |
| 2 | Apple Foundation Models | ✅ verified 2026-06-03 |
| **3** | **Study Orchestration Engine — "the linking"** | ❌ **never spec'd** |
| 4 | Social Learning | 🟡 partial |
| 5 | Contextual Mnemonic Co-Creation | 🟢 B145 |
| 6 | Study Log (enhanced Journal) | ❌ not built |
| 7 | Onboarding | 🟡 shipped, data inert |

**Phase 5 — the signature feature — shipped before Phase 3, the phase that
connects everything.** That inversion is why Buddy reads as partial: it has a
spectacular set-piece and no spine, appearing at Session Complete and nowhere
else. Phase 3 is precisely what the owner described, and §6's three scaffolding
levels are literally *"a long and evolving journey."*

Four owner observations from B145 testing (recorded in `ENHANCEMENTS.md` under
**🌱 New Learner Experience**) map onto this phase: onboarding data unused,
placement results discarded, explanatory content never surfaced, and the
Journal's purpose unsettled. The first three are this spec. The fourth is
Phase 6.

**The app already promises what this spec would build.** Onboarding's own copy
reads: *"Kanji Buddy is an AI-powered learning companion that builds a study
plan around you — your goals, your pace, your weak spots."* No study plan is
generated, `goals` is a column nothing writes (§11), and pace informs nothing.
That sentence is the specification, and it has been shipping to every new user
as a claim rather than a description.

## 2. Scope

**In:** Scaffolding **Level 1 (Guided)** and the first weeks of a learner's
life — frame selection, position, plan, invitations at boundaries, milestone
celebration, and progressive teaching.

**Out, deliberately:**

- **Leech detection** and **confused-pair drills** — also Phase 3, each a Wave 3
  roadmap item in its own right. Including them doubles this spec.
- **Scaffolding Levels 2 and 3** — designed for (the level is an input), not
  built.
- **The social consumer of milestone events** — designed in, built in Phase 4.
  See §7.
- **Localized catalogues** — the structure is built now, English only. See §6.

**Audience: launch.** This is the front door for strangers, so every path must
hold — placement skipped, onboarding skipped, no network, a month away and back.
Not just the happy path.

## 3. Decisions, with rationale

| Decision | Rationale |
|---|---|
| **Invitation, not instruction** | The parent spec's Level 1 describes a checklist that prompts after each activity. The owner's track record cuts the other way — the immediate quick-check was deleted rather than fixed (B-218), coaching is an opt-**out**, "Not now" earned a 7-day cooldown. A checklist would be the first thing removed. |
| **Prize = a JLPT level; rungs = milestones on several ladders** | JLPT gives an external deadline and social meaning. But its ladder is lopsided — N1 alone is **1,308 kanji, 57% of the deck** — so it cannot supply frequent reward. The existing milestone ladders do. |
| **Ruler inferred, not asked** | `milestoneFocusFromReasons` already maps reasons → `jlpt` \| `grade` and drives badge selection. Generalising it makes the onboarding questionnaire load-bearing, which is the fix for observation #1. |
| **Ask only on genuine ambiguity** | Owner: *"let's infer when we can based on what they have already told us. If they skip the onboarding questions or we need to disambiguate then we have no alternative than to ask directly."* |
| **Buddy states the inferred frame** | A silent wrong guess yields an app that feels subtly off with no way to correct it. A stated guess corrects itself. |
| **Never project beyond the next rung** | *"All 2294 Jouyou kanji: Jul 2053"* is not a copy bug; the system computes a number it has no business computing. Removing the capability removes the class of bug. |
| **Decisions in `packages/shared`, copy from the API** | Pure functions are the only testable unit in this repo (§9). Server-side copy means Buddy's voice — and later, other languages — can change without an EAS build. |

## 4. Architecture

Five moments. Each exists today; none connects to the next.

```
Onboarding  →  Placement  →  Frame  →  Plan  →  Daily loop ⟲  →  Milestone
 (writes)      (measures)   (infer)  (derive)   (invitations)    (celebrate + teach)
```

| | Where | Purpose |
|---|---|---|
| **A. Frame** | `packages/shared/src/buddy/frame.ts` | reasons → ruler, or `ask` |
| **B. Position** | `packages/shared/src/buddy/position.ts` | destination + near-term rungs |
| **C. Invitation** | `packages/shared/src/buddy/invitation.ts` | at most one offer, or silence |
| **D. Context** | `apps/api` — `GET /v1/buddy/context` | assembles state, serves catalogue |
| **E. Teaching moments** | catalogue content | keyed to milestone events |

Four of five are pure functions. The only I/O is the context fetch.

```
reasonsForLearning ─┐
                    ├─→ resolveFrame ─→ ruler ─┐
learner.explicit ───┘                          ├─→ Position ─┐
placement + progress ──────────────────────────┘             ├─→ selectInvitation ─→ Invitation | null
signals, declines, scaffolding ──────────────────────────────┘
```

## 5. Components

### A. Frame

```ts
type Ruler = 'jlpt' | 'grade'

type FrameResolution =
  | { kind: 'chosen';   ruler: Ruler }
  | { kind: 'inferred'; ruler: Ruler; from: string[] }
  | { kind: 'ask' }

function resolveFrame(input: {
  explicitRuler?: Ruler
  reasons: string[]
}): FrameResolution
```

Rules, in order: an explicit stored choice always wins; then the existing
mapping (`jlpt`/`work`/`business` → `jlpt`; `heritage`/`curiosity` → `grade`);
then **`ask`** for empty reasons, unmatched reasons, or *both* groups present.

`from` carries which reasons drove it, so Buddy can say why.

**Divergence from shipped behaviour, deliberate.** `milestoneFocusFromReasons`
resolves both-groups-present to `jlpt` — acceptable for choosing badges, a
coin-flip for framing the whole app. `milestoneFocusFromReasons` becomes a thin
wrapper collapsing `ask` to its current default, so the Progress tab is
unchanged and the mapping lives in one place.

**⚠️ The existing matcher is `r.includes(n)` over lowercased display text.** If a
chip is reworded from "Heritage" to "Family roots", inference silently falls
through to the default and nobody notices. Chips must be pinned to stable values
rather than matched on labels. This is a prerequisite, not a nicety.

### B. Position

```ts
type Position = {
  ruler: Ruler
  destination: {
    current: Rung
    next: Rung | null
    projectedDate: string | null
  }
  upNext: UpNextEntry[]
}
```

**Two layers, because the ruler alone cannot carry motivation.**

*Destination* is the prize — rare, months apart, gives direction.

*`upNext`* is the journey, supplied by the **already-shipped** `computeUpNext`,
which returns the next threshold per category and already accepts both
`perGrade` and `perJlpt`.

The scale difference is the design:

| | Count across a full journey |
|---|---|
| JLPT ruler rungs | **5** |
| Orthogonal milestones (3 count ladders × 10, grade tiers, JLPT tiers, open-ended streaks) | **60+** |

`COUNT_LADDER = [10, 50, 100, 250, 500, 750, 1000, 1250, 1500, 2000]`,
`STREAK_LADDER_FINITE = [3, 7, 10, 14, 21, 28, 35, 42, 49]` then +7 forever.

A learner inside N4 with a projected burn of Dec 2026 still hears about 750
seen, a 21-day streak, grade 3 reaching silver — several times a week rather
than twice a year.

**`projectedDate` covers the next rung only.** There is no field for full-deck
completion, so the 2053 string cannot be constructed. It is `null` when there is
too little data, or when the estimate exceeds one year — a next rung dated 2029
is the same failure in miniature. Buddy says *"a bit early to estimate"*, which
is true.

### C. Invitation

```ts
type Boundary = 'app_open' | 'session_complete' | 'milestone_reached'

function selectInvitation(input: {
  boundary: Boundary
  position: Position
  scaffolding: 'guided' | 'coached' | 'autonomous'
  signals: LearnerSignals
  declined: Record<string, string>
  lastInvitationAt: string | null
  now: Date
}): Invitation | null
```

**`Boundary` has no mid-session member.** "Never interrupt retrieval" becomes a
property of the type — there is no value expressing it. `milestone_reached`
fires on any of the 60+, so it is a regular event; a ruler rung is the rare loud
one, and the natural place for a teaching moment because it has earned
attention.

This function owns **every** anti-nag rule in one testable place: one invitation
per boundary, declines remembered per key with cooldown, a global frequency cap,
and the coaching opt-out. **Returning `null` is the common case.**

With 60+ milestones the frequency cap stops being a nicety and becomes
load-bearing — three ladders crossing in one session must yield one celebration,
not three.

### D. Context endpoint

`GET /v1/buddy/context` returns learner state plus the message catalogue for the
resolved locale. Cached client-side like the review queue, so Buddy speaks on a
bad connection and the cross-region round trip (B-208) does not gate app open.

**Route-registration guard required.** This prefix family has swallowed static
paths three times (`/refresh`, `/assemble`, `/buddy-moment-context`). Mirror the
test added for `GET /v1/mnemonics` on 2026-07-28.

### E. Teaching moments

Content keyed to milestone events, delivered **inside** the celebration rather
than as a separate interruption — observation #3: congratulate, then explain the
panel they now have data in. Message ids in the catalogue; no new machinery.

Constraints drawn from this repo's own history: dismissible **and** re-openable
(the study explainer writes `kl_has_seen_study_help` and can never be summoned
again); respects the coaching opt-out; never mid-session.

## 6. Localization structure

**Buddy must be able to speak Italian, German or French later without
restructuring.** Not built now; not designed out.

**The load-bearing rule: pure functions never return prose.** They return a
message reference.

```ts
type MessageRef = {
  id: string                              // 'invite.writing_leg'
  params?: Record<string, string | number | Date>
}

type Invitation = {
  kind: InvitationKind
  message: MessageRef                     // never a string
  action: { tab: TabName; context?: unknown }
  declineKey: string
}

type MessageCatalogue = {
  locale: string                          // 'it-IT'
  fallbackChain: string[]                 // ['it', 'en'] — always ends at 'en'
  messages: Record<string, string>        // ICU MessageFormat
}
```

**ICU MessageFormat, not template strings.** `` `${n} kanji` `` breaks outside
English — plural *categories* differ by language, and French and Italian agree
on gender. ICU puts that where a translator can reach it:

```
"rung.remaining": "{count, plural, one {# kanji to go} other {# kanji to go}} before {rung}"
```

**Fallback is per-key, not per-locale.** A half-translated catalogue renders
Italian where it exists and English elsewhere. Rejecting incomplete locales is
what stops translations ever being finished.

### Three tiers

| Tier | Example | This spec |
|---|---|---|
| **1. Buddy's voice** | invitations, celebrations, teaching | **Structured now**, English only |
| **2. Glosses** | 言 → "speech", kanji meanings | Kept behind a lookup so it stays possible — 2,294 rows × N languages is its own project |
| **3. Japanese content** | kanji, readings, sentences | **Never localized** — it is the subject matter |

**Locale resolution:** device locale via `expo-localization`, overridable by a
new `user_profiles.locale` column — the sibling of `timezone`, which Task 17
proved works. `learner_profiles.country` is already collected and gives a signal
on day one.

**Consequence for existing code:** `speakMixed` hardcodes `'en-US'` for every
non-Japanese run, so an Italian learner would hear Italian prose in an American
voice. The segmenter must take the learner's locale as a parameter. Small now,
awkward later.

## 7. Milestone events and the social fan-out

A milestone is never wasted, only routed.

```
milestone_reached ─┬─→ selectInvitation    (learner) — one per boundary
                   └─→ selectSocialSignal  (mates)   — max one per day
```

Owner, 2026-07-28: *"we can always use smaller milestone achievements as the
subject to share with Study Mates even if we do not overtly celebrate each with
the learner. We might have just celebrated a 14 day streak, and tomorrow when
the learner hits Grade 1 gold we communicate that with all his study mates."*

The parent spec anticipated this — §10 lists **Milestone sharing** and **Friend
celebration** among its seven nudge categories, and supplies the rate limit:
**maximum one social nudge per day**, explicitly to avoid pressure fatigue.

**These are not one function with two caps.** What is meaningful to the learner
and what is legible to a friend differ — "Grade 1 gold" reads instantly to
someone else, "750 kanji seen" does not. `selectSocialSignal` ranks by
legibility; `selectInvitation` ranks by need.

**Delivery already exists.** `notifyStudyMates` fans out respecting
`notificationsEnabled`, per-friendship directional mute, and a 24-hour cap. This
is new selection, not new delivery.

**Built in Phase 4, designed in now.** A brand-new learner has no study mates,
and §10 says Buddy must not nag about adding them — so this is not new-learner
functionality. But the event must be **published**, not merely passed to
`selectInvitation`: otherwise a milestone the learner-facing cap swallows is
genuinely gone, and there is nothing left to share tomorrow. Publishing the event
is what makes the banked-for-mates idea possible at all.

The parent spec's guardrails apply: never lead with a negative comparison;
suppress social framing entirely when the learner is behind across the board;
never reveal struggles without opt-in.

## 8. Failure paths

**Silence is the safe failure.** When Buddy lacks the data to say something
true, it says nothing. No failure path needs a fallback message, which is where
these systems usually accumulate lies.

| Path | Behaviour |
|---|---|
| **Placement skipped/abandoned** | Frame still resolves from reasons. Position `unknown`. Buddy offers placement **once**, declinable, remembered. Declined → position accrues from study. Never blocked on placement. |
| **Onboarding skipped** | Frame `ask` — but **not on first launch**. Someone who just skipped a questionnaire will not welcome another question. Deferred to a later boundary. |
| **Context fetch fails** | Cached context. No cache → silence. |
| **Returns after a month** | The dangerous one. Streak broken, position stale, `upNext` possibly regressed. Buddy must **not** lead with the loss — re-entry gets its own selection branch. Orient, do not audit. |
| **Places at N2** | Not a new learner despite being new to the app. Scaffolding is `2 weeks **or** 50 kanji` — the OR handles it. |
| **Ruler exhausted** (`next: null`) | Offer the other ruler, or the deck. Must not render "0 kanji to go before undefined". |
| **Milestone fires offline** | Event is durable, queued like pending sessions. A milestone lost to a dropped connection is a reward the learner earned and never received. |
| **B-210 interaction** | Retaking placement destroys FSRS state. **B-210 must be fixed before** this spec makes placement more attractive. |

## 9. Testing

Four of five components are pure because **this repo cannot test any other
way**. Jest runs in a `node` environment with no JSX transform and cannot load
ESM — a constraint that forced three extractions on 2026-07-28 alone
(`teachingBeat`, `segmentByScript`, `selectStudyScreen`). With roughly one EAS
build available before 2026-08-04, behaviour proven only on device is behaviour
not proven.

- **`resolveFrame`** — table-driven over reason combinations, including
  both-groups → `ask` and empty → `ask`.
- **`selectInvitation`** — the highest-value tests assert **`null`**: within
  cooldown, cap reached, coaching off, nothing worth saying. Anti-nag rules are
  only real if a test fails when they break.
- **`Position`** — ruler exhausted, zero pace, projection >1yr → `null`,
  insufficient data → `null`.
- **Catalogue completeness** — every `MessageRef` id any function can emit must
  exist in the English catalogue. A missing key ships silently, so it gets a
  test that enumerates them.
- **API** — route-registration guard on `/v1/buddy/context`; integration test
  for the assembled payload.
- **Mobile** — pure reducer beside a thin hook, mirroring `useCoCreation`.

**What testing cannot prove:** whether Buddy's voice lands. No unit test says
whether an invitation feels supportive or pestering. That is a device judgement,
and it is the owner's — another reason copy is served, so tuning costs no build.

## 10. Prerequisites

1. **B-210** — placement retake destroys FSRS state. Must be fixed first.
2. **Onboarding chips pinned to stable values**, not matched on display text
   (§5A).
3. **The kanji-count sweep** (`BUGS.md`, re-scoped 2026-07-28) — two honestly
   named constants, `TOTAL_JOUYOU_KANJI = 2136` and `TOTAL_DECK_KANJI = 2294`.
   Position arithmetic depends on which question is being asked, and a third
   number (2254) is still unexplained.

## 11. Open questions

- **When several milestones land at once**, does Buddy mention the single best
  one, or briefly acknowledge all? Raised, not settled.
- **Exam date source.** Hard-coding two dates a year is trivial and stale by
  definition; scraping is fragile. A small seeded table with an annual manual
  refresh is probably the honest answer.
- **`goals` and `interests` are dead columns — verified 2026-07-28.** Both exist
  on `learner_profiles` *and* `learner_profile_universal`, and **nothing in
  `apps/api` or `apps/mobile` writes either.** Onboarding writes only
  `country` and `reasonsForLearning`, with an explicit comment saying it must
  not touch `interests` because the PATCH is an upsert that would overwrite
  prior selections with `[]`. So the only learner-supplied signal that exists is
  `reasonsForLearning` — which is what §5A infers from. Decide whether to
  populate `goals`/`interests` or drop them; four unused jsonb columns across
  two tables invite a future reader to trust them.

## 12. What this explicitly does not do

- Leech detection, confused-pair drills (Phase 3, later slice)
- Scaffolding Levels 2 and 3 (input only)
- The social consumer (Phase 4)
- Any non-English catalogue
- The Study Log / Journal reimagining (Phase 6)
