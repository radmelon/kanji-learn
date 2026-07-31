# The Weekly Buddy Review — design

> **Canonical URL:**
> https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-07-30-weekly-buddy-review-design.md

**Status: DRAFT, in progress.** Sections 1–5 are designed and owner-approved.
Sections 6–10 are not yet written — see §11. Do not plan from this document
until it is complete and the user-review gate has passed.

Companion to
[`2026-07-28-new-learner-arc-design.md`](2026-07-28-new-learner-arc-design.md).
That spec is edited in three places by this one (§3, *What this absorbs*); it is
not superseded.

---

## 1. Why this exists

The Arc spec describes three things it never gives a home to:

| Orphan | Where it says it | The problem |
|---|---|---|
| Frame's `ask` case | §5A | Buddy must ask which ruler the learner is on, with no described surface for asking |
| The planner | §5B2 | "On request" — but nothing describes the request |
| The frontier-surprise retest trigger | §12 | Deferred outright for want of a container |

All three are the same shape: **something Buddy needs to raise, with no licence
to raise it.** The Arc spec's central rule — *never project unbidden* — is what
denies the licence, and correctly: a distant date volunteered as encouragement is
a sentence being served.

The owner's synthesis (2026-07-30) supplies the missing container: **a weekly
scheduled study-plan review with Buddy.** One surface answers all three orphans,
which is usually the sign a decomposition is right.

**It runs in both directions.** Ahead of expectation — *"you've learned more than
expected, want to recalibrate?"* Behind — *"November is looking tight, here are
the dials."* That symmetry is what makes it a **review** rather than a reward,
and it is the property most likely to be designed away. It is not optional.

**It is unblocked by real data as of `main` @ `8f745c2`.**
`placement_sessions.ability_theta` and `.ability_se` now exist, so the
comparison has something to run on.

## 2. Decisions taken, with rationale

| # | Decision | Rationale |
|---|---|---|
| 1 | **The review *is* the plan mechanism.** No static plan artifact; each session sets the coming week's commitment, and the next session reviews it. | A stored long-range plan you keep missing is worse than no plan — it recreates the sentence-being-served problem in slow motion. A one-week horizon is the natural antidote without banning long horizons outright; the planner (Arc §5B2) still answers those on request. |
| 2 | **A conversation with a spine**, not free chat and not generated copy in fixed cards. | Under free chat the commitment is the first casualty of a good conversation — delightful sessions that never set the week. The spine guarantees the outcome while leaving everything around it genuinely open, and it is a pure function over session state, which is the only thing this repo can test well (Arc §9). |
| 3 | **The commitment is effort, not volume** — days and minutes, with an optional focus. | Volume is not the learner's to control: new kanji per week depends on review debt, FSRS intervals, and how hard this week's cards are. A learner can do everything right and miss a volume target, which is precisely the "less than hoped reads as failure" case. Effort is the only variable they own. Already the owner's stated position — Arc §5C3: *"Regularity is more important than infrequent streaks."* |
| 4 | **The hard conversation is deadline-triggered, not scheduled.** | Buddy raises "you will not make November" only when there is an external fact (a test date the learner named) **and** a computed miss. Not on a cadence, not on a feeling. |
| 5 | **Learner memory splits by who reads it**: if a pure function branches on it, it is a typed field; if only the language model reads it, it is a fact row. | Keeps the profile schema from growing a column every time Buddy learns something charming, and matches the repo's existing split — pure decisions in `packages/shared`, copy from the API. |
| 6 | **Buddy asserts learner facts freely and world facts only from retrieval.** | Established by a live failure during this brainstorm: a cultural connection was asserted from model recall, disputed, and settled correctly by a web lookup. The fact was real; the recall was not. The rule is therefore not "avoid cultural claims" but "claims about the world come from retrieval." Enforced by `provenance` in §5. |
| 7 | **Elegant reuse where the shape genuinely matches, a new table where it does not.** | Five tables exist in `schema.ts` with zero code references. Two are the right shape for this work and are adopted; one (`study_plans`) is shaped for the model decision #1 rejected, and adopting it would drag the design back by gravity. |
| 8 | **`buddy_day` is its own column, independent of `rest_day`.** | Owner, 2026-07-30. Conflating them means the one day the learner protects is the day Buddy shows up. They may coincide; that must be the learner's choice, not a schema consequence. |

## 3. Architecture

**The appointment is a third mode, and naming it is the load-bearing move.**

```
                    ┌── push ──────── ambient, Buddy speaks small ──── Invitation (Arc §5C)
learner's week ─────┼── pull ──────── learner asks ──────────────────── Planner (Arc §5B2)
                    └── appointment ─ agreed in advance, weekly ─────── THIS SPEC
```

The Arc spec has *push* (unbidden, encouragement) and *pull* (learner-initiated,
planning). The weekly session is neither: the learner agreed to it in advance, on
a day they chose, so Buddy may **bring** things without those things being
unbidden. That single property is what unlocks all three orphans in §1.

### Components

Four pure, one I/O — matching the Arc spec's shape deliberately, so the two
specs read as one system.

| | Where | Purpose |
|---|---|---|
| **A. Schedule** | `packages/shared/src/buddy/appointment.ts` | is a session due, missed, or not yet |
| **B. Reckoning** | `packages/shared/src/buddy/reckoning.ts` | commitment vs reality, projection vs target — both directions |
| **C. Agenda** | `packages/shared/src/buddy/agenda.ts` | what this session still owes: beats, ranked, bounded |
| **D. Commitment** | `packages/shared/src/buddy/commitment.ts` | validate and shape the week being agreed |
| **E. Session** | `apps/api` — `/v1/buddy/session` | assembles context, runs the conversation, writes results |

### Generation tiers

`buddy_nudges.generated_by` is already `'template' | 'on_device' | 'cloud'`, with
a rate limiter (`buddy_llm_usage`) and telemetry (`buddy_llm_telemetry`) behind
`llm_tier`. The weekly session is a **cloud** surface — it needs retrieval and
real context — with a **template** tier as its permanent floor.

**This means slice 1 is not a prototype to be thrown away.** Shipping the ritual
with template copy builds the tier that afterwards serves every offline session,
every rate-limited session, and every LLM outage. The conversation layer upgrades
a path that must exist regardless.

### What this absorbs, and what it leaves alone

**Absorbs:** Frame's `ask` case, the planner's entry point, the retest trigger.

**Leaves alone:** `Invitation` (Arc §5C) is untouched. Milestones keep firing
between sessions — holding a 1,000-kanji celebration for five days to save it for
Sunday would be worse than saying it now. `Position` (Arc §5B) becomes a read
model this session consumes.

## 4. The session shape

### The agenda is a set of owed beats, not a script

Buddy carries them in; the learner's replies decide the order; Buddy finds its
way back rather than steering.

| Beat | What it is | Required |
|---|---|---|
| **Open** | Chosen by the shape of the week — see below | **yes** |
| **Reckon** | Last week's commitment: kept, partly, missed — stated without scolding | no |
| **Raise** | Anything the data says the learner should know. Both directions. **Usually nothing.** | conditional |
| **Draw out** | One question about the learner Buddy does not yet know the answer to | no |
| **Connect** | One offered link between a kanji met this week and something the learner knows | no |
| **Set** | The coming week's commitment | **yes** |

Beats may be satisfied out of order, and by the learner without Buddy asking —
which is why the agenda is a pure function over what the conversation has already
produced, not a step counter.

### The opening is a decision, and a poor week opens with care, not data

| Week | Opens with | Never |
|---|---|---|
| **Strong** | Specific praise — *"five days, and you cleared the backlog"* | generic "great job!" |
| **Steady** | Light acknowledgement, straight into the week | making a fuss |
| **Off** | **A question about the person.** Work busy? How is it going? | numbers in the first turn |
| **Absent** | Warmest, lowest-demand. Glad you are here. | any accounting at all |
| **First ever** | Introduction and the frame question — a different session entirely | assuming context |
| **Mates active** | Their week, as a way in — a variant available on any of the above | if the social surface is not live |

Leading with care rather than softer numbers is the actual mechanism behind
"less than hoped must not read as failure." The reckoning still happens — it
happens *after* Buddy knows whether work was busy, which is also the information
that makes the next commitment realistic. Asking first is better manners and
better data.

The study-mate opener is designed in but **gated on what is live**:
`friendships` and `shared_goals` exist, but Phase 4 social is partial, and this
must not block on it.

### The commitment is carried forward and confirmed, never constructed

Last week's commitment rolls into next week as the standing default the moment
the session opens. The conversation is a chance to **change** it, not a
prerequisite for having one.

**This inverts the failure mode.** If the learner opens the session, says "not
now," and closes it at turn two, the week is still set and nothing is broken. A
session that must *reach* the final beat to produce a commitment produces nothing
on a bad day — which is the day it matters most.

### Drift is followed, never blocked

If the learner answers "how did the four days go?" by talking about a family
recital, Buddy goes there. That is not a detour: it is the **Draw out** beat
arriving early and better than Buddy could have asked for.

The only hard constraint is a **turn cap**, bounding cost and attention together.
As it approaches, Buddy closes on the commitment.

### Duration, and asking for more of it

**Target feel: five minutes.** A pal checking in, not a performance review. Under
the template tier the same beats render as a short card sequence — same
structure, no conversation.

When the reckoning turns up something needing strategy, Buddy **asks for the
time** rather than taking it:

> *"There's something about November I'd like to talk through properly. Got
> fifteen minutes, or shall we pick it up next week?"*

Two rules keep the deferral honest:

- **Defer the conversation, never the fact.** If the learner says next week,
  Buddy still gives the one-line version — *"short version: November's looking
  tight at the current pace"* — and lets it go. A deferral that also suppresses
  the headline is how a learner arrives at November surprised.
- **Deferral is bounded by the deadline, not by a counter.** The closer the
  target date, the shorter the runway; at some point the conversation simply *is*
  the session, because there is no later left. This falls out of date arithmetic
  rather than needing a "you have deferred twice" rule.

### Elicitation is targeted, and refusals are permanent

Which question Buddy asks is a pure function of what the profile lacks, what has
already been asked, and what the learner declined. **A decline is permanent** —
matching how this app already treats "Not now" (Arc §3; the 7-day coaching
cooldown; the deleted immediate quick-check).

## 5. Data model

### Three new columns, two new tables, four reused, two retired

**On `user_profiles`:**

```
buddy_day   smallint  null    -- 0=Sun…6=Sat. null = no appointment yet
```

`reminder_hour` is **reused** for the time rather than adding `buddy_hour`: the
learner has already set an hour that suits them. If a weekend sit-down wants a
different hour than a weekday nudge, the first session can ask and the column
gets added then, knowing why.

`buddy_day` is nullable rather than defaulted, because null is meaningful — *no
appointment yet* — and is the correct state for every existing user and every new
one before their first session. It is independent of `rest_day` (decision #8).

### New — `buddy_commitments`

```
id, user_id, week_start date
days_committed  smallint       -- the promise: how many days
day_targets     jsonb null     -- optional specific days; null = any N days
minutes_per_day smallint       -- snapshot of daily_goal at agreement time
focus           text null      -- the optional qualitative flavour
source          text           -- 'session' | 'rolled_forward' | 'default'
agreed_at, superseded_at
unique (user_id, week_start)
```

**`source` is the column that earns its place.** A rolled-forward commitment was
never actually promised — the learner did not show up to agree it. Scoring it as
a broken promise would be Buddy holding someone to words they never said. The
reckoning reads `source` and changes register:

- missed `'session'` → *"we said four, you got two — what happened?"*
- missed `'rolled_forward'` → *"I kept last week's four going by default, and
  that may not have been the right call."*

**The outcome is derived, not stored.** What actually happened lives in
`daily_stats` and `review_logs` already. A stored score would be a second version
of the truth, free to drift from the first.

### New — `buddy_learner_facts`

```
id, user_id
fact         text          -- "spent summers near Oita"
kind         text          -- place | interest | routine | person | work | other
provenance   text          -- 'stated' | 'inferred' | 'imported'
confidence   real          -- meaningful only for 'inferred'
source_session_id uuid null
retracted_at timestamptz null
```

**`provenance` makes decision #6 enforceable rather than aspirational.**
`'stated'` — the learner said it, Buddy asserts it freely. `'inferred'` — Buddy
worked it out, Buddy hedges or checks. `'imported'` — the seeding pass. Without
this column the rule is only a hope about prompt-writing.

**One fact per row: atomic, self-contained, independently meaningful.** Three
statements from one session become three rows. This costs nothing today, makes
facts individually retractable by the learner, and is what keeps the embedding
decision below reversible.

#### No embeddings, and the condition that changes that

Retrieval here is **per-learner**, and user growth does not change the retrieval
unit: composing one learner's session loads that learner's facts. At 10,000 users
the table holds ~400,000 rows and every query is `WHERE user_id = ?` returning
about forty. The table grows; the searched set does not.

One learner accumulates one or two facts per weekly session — 50–100 a year.
Several years in, a few hundred, still comfortably inside a session prompt.

**The asymmetry that settles it: embeddings are recoverable, provenance is not.**
Adding vector search later is a column plus a backfill over text already owned.
But provenance not captured at write time is gone forever. The rule is *capture
what cannot be recomputed, defer what can.*

Adding them now is also not free: an embedding call on every fact write means
fact-writing acquires a new failure mode, and embeddings are model-specific — a
model change means re-embedding regardless.

**Move to embeddings when either holds:**

1. A single learner's facts stop fitting comfortably in a session prompt (order
   of a few hundred), **or**
2. Connections are to be reused *across* learners — *"this link worked for other
   people who like jazz."* This is the likelier trigger and it is genuinely
   embedding-shaped, but it lives in `learner_memory_artifacts` with its
   `effectiveness_score`. Different table, different feature, its own decision.

### Reused

| Table | Use | Today |
|---|---|---|
| `buddy_conversations` | transcript, `context='weekly_session'` | 0 refs; correctly shaped already |
| `learner_timeline_events` | `session_completed`, `commitment_set` — same pattern as `review_completed` | live, via `DualWriteService` |
| `learner_memory_artifacts` | the connections: `subject='kanji:説'`, `type='note'`, scored by `effectiveness_score` | 0 refs; exactly its design intent |
| `learner_profiles` + `learner_profile_universal` | structured spine, via the dual-write the profile route currently skips | app half live, UKG half unwired |

**Transcripts expire; facts persist.** `buddy_conversations` already carries
`expires_at`, and that is right — the conversation is ephemeral, what Buddy
*learned* from it is not. Two tables because they have genuinely different
lifetimes.

**On `learner_memory_artifacts` and the `subject` convention.** `subject` means
*a thing being learned* — it is constructed in exactly two places, both
`kanji:${character}` (`apps/api/src/services/buddy/dual-write.service.ts:124`,
`:216`), and `learner_knowledge_state`'s primary key is `(learner_id, subject)`.
Buddy's connections fit that convention unmodified. **Learner facts do not**, and
a `learner:` subject convention was rejected: it would put two incompatible
meanings of `subject` into a namespace `learner_knowledge_state` shares.

**On the profile pair.** `learner_profiles` (app-side, live — read by
`learner-profile.ts` and the tutor report) and `learner_profile_universal`
(UKG-side, zero refs) carry near-identical columns. That is not two designs; it
is one design whose mirror was never built. The structured spine therefore needs
no new table — it needs `PATCH /learner-profile` to go through
`DualWriteService` the way review submission does. That also answers "which one
does the session write?" before it can become a bug.

### Retired

- `study_plans` and `study_plan_events` — **superseded, dropped.** They store
  `activities[] + rationale + scaffold_level + expires_at +
  completed_count/skipped_count`: a *generated activity list*, which is the model
  decision #1 rejected. Ours is a learner-agreed weekly promise — different
  shape, different lifecycle, different author.
- `study_log_entries` — **handed to Phase 6 untouched.** It is the Journal's
  table and the Journal is Phase 6's job.

### Carried to the plan, not the spec

- **Verify against live before dropping anything.** None of the five dead tables
  appear in `packages/db/supabase/migrations/`; `0016`'s comments imply the UKG
  group exists by another route. What is actually in the live database is a
  question for a live session — and this repo's own SOP says verify by content
  rather than assume.
- **RLS policies** for both new tables, following `0009` / `0018`.
- **`buddy_learner_facts` must be in the user-delete path.** Personal data by
  definition; a `user-delete` integration test already exists; this is exactly
  the kind of table that gets forgotten.

## 6.–10. Not yet written

| § | Section | Notes carried in |
|---|---|---|
| 6 | **The reckoning and escalation** | Deadline-triggered (decision #4). Dials that already exist as columns: `daily_goal` (minutes), `reminder_hour` (time of day), `buddy_day`. Both directions from one comparison. Time-of-day *suggestion* quality depends on the deferred behaviour model (Arc §12) — but the dial itself ships now, and **Buddy can simply ask** rather than infer. |
| 7 | **Content and grounding** | Decision #6 and `provenance`. The four-hop connection move (説 → 小説 → a specific book → a place the learner knows). What Buddy may assert, hedge, or must look up. |
| 8 | **Failure paths** | Missed sessions, no network, LLM unavailable (→ template tier), a learner with no data, a learner who never opens it, a learner who opts out entirely. |
| 9 | **Testing** | Pure lane for Schedule / Reckoning / Agenda / Commitment. Component lane for the session screen. What genuinely needs a device. |
| 10 | **Slices** | Agreed order: **(1)** ritual + commitment, template tier, no LLM; **(2)** the conversation — cloud tier, session store, facts, seeding pass; **(3)** the connection engine — grounded retrieval. Each shippable alone. |

## 11. Open questions

1. **Whether a weekly session may write to `daily_goal` directly**, or only
   propose a change the learner confirms. Leaning: propose-and-confirm, since it
   is a setting the learner owns.
2. **Whether the learner-visible fact list ships in slice 2 or slice 3.** Raised
   during brainstorming, not yet answered. The argument for early: an unseen
   dossier is surveillance, the same list shown back is a relationship — and it
   is free error correction when Buddy has misremembered.
3. **What happens to a learner with no `buddy_day` set** — is the appointment
   offered during onboarding, on first milestone, or never until asked?
4. **Turn cap value**, and whether it differs between the five-minute session and
   an accepted crucial conversation.
