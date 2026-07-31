# The Weekly Buddy Review — design

> **Canonical URL:**
> https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-07-30-weekly-buddy-review-design.md

**Status: complete, awaiting user review.** All sections designed and approved
section-by-section during the 2026-07-30 brainstorm. Open items are in §11.

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
| 1 | **The review *is* the plan mechanism.** No static plan artifact; each session sets the coming week's commitment, and the next session reviews it. | A stored long-range plan you keep missing is worse than no plan — it recreates the sentence-being-served problem in slow motion. A one-week horizon is the natural antidote without banning long horizons; the planner (Arc §5B2) still answers those on request. |
| 2 | **A conversation with a spine**, not free chat and not generated copy in fixed cards. | Under free chat the commitment is the first casualty of a good conversation — delightful sessions that never set the week. The spine guarantees the outcome while leaving everything around it open, and it is a pure function over session state, which is the only thing this repo tests well (Arc §9). |
| 3 | **The commitment is effort, not volume** — days and minutes, with an optional focus. | Volume is not the learner's to control: new kanji per week depends on review debt, FSRS intervals, and how hard this week's cards are. A learner can do everything right and miss a volume target — precisely the "less than hoped reads as failure" case. Effort is the only variable they own. Already the owner's position, Arc §5C3: *"Regularity is more important than infrequent streaks."* |
| 4 | **The hard conversation is deadline-triggered, not scheduled.** | Buddy raises "you will not make November" only when there is an external fact (a test date the learner named) **and** a computed miss. Not on a cadence, not on a feeling. |
| 5 | **Learner memory splits by who reads it**: if a pure function branches on it, it is a typed field; if only the language model reads it, it is a fact row. | Keeps the profile schema from growing a column every time Buddy learns something charming, and matches the repo's split — pure decisions in `packages/shared`, copy from the API. |
| 6 | **Buddy asserts learner facts freely and world facts only from retrieval.** | Established by a live failure during this brainstorm: a cultural connection was asserted from model recall, disputed, and settled correctly by a web lookup. The fact was real; the recall was not. The rule is therefore not "avoid cultural claims" but "claims about the world come from retrieval." Enforced by `provenance` in §5. |
| 7 | **Elegant reuse where the shape genuinely matches, a new table where it does not.** | Five tables exist in `schema.ts` with zero code references. Two are the right shape and are adopted; `study_plans` is shaped for the model decision #1 rejected, and adopting it would drag the design back by gravity. |
| 8 | **`buddy_day` is its own column, independent of `rest_day`.** | Owner, 2026-07-30. Conflating them means the one day the learner protects is the day Buddy shows up. They may coincide; that must be the learner's choice, not a schema consequence. |
| 9 | **No Buddy on/off switch. Cadence is the learner's instead.** | Owner: *"KanjiBuddy with Buddy turned off is KanjiLearn."* A master switch is a tax on every future feature and makes the calibrated controls (coaching opt-out, declines, cooldowns) pointless. **But the exit exists whether or not it is built** — a learner who has had enough mutes iOS notifications, which is silent and teaches us nothing. So the quiet exit must be ours: weekly → fortnightly → when-I-ask, plus the automatic step-down in §8.1. Toned-down Buddy already exists as the Arc's scaffolding level. |
| 10 | **No catalogue of what Buddy knows — and no data dump on request either.** | Owner, 2026-07-30: a dump with a conversational trigger is still a catalogue. "What do you know about me?" opens a conversation; Buddy answers from salience with two or three recent, relevant things and hands the question back. See §7.1. **Consequence:** retraction must be a real capability, not a polite reply (§7.1). |
| 11 | **Effort and target are offered as peers; moving the target is never framed as giving up.** | From the owner's escalation script. Every instinct leads with "how do we make November" and holds "change the target" in reserve as the fallback. Side by side is the difference between a coach and a tracker — and it is true: goals legitimately change, and an app that treats that as failure is wrong about the learner. |
| 12 | **Embeddings on the connection library, never on learner facts.** | Two different problems. Learner facts: tens of rows, one learner, loaded whole, and embedding-on-write would give a user-facing path a new failure mode. The library: unbounded, cross-learner, matched by meaning, embedded at harvest time which is already async. See §5.3 and §7.3. |

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

It has a second consequence that §7.3 depends on: **an appointment can be
prepared for.** An ambient nudge might fire at any moment, so nothing can be
computed ahead of it. A scheduled sit-down can have its material assembled hours
in advance.

### Components

Four pure, one I/O — matching the Arc spec's shape deliberately, so the two
specs read as one system.

| | Where | Purpose |
|---|---|---|
| **A. Schedule** | `packages/shared/src/buddy/appointment.ts` | is a session due, missed, late, or stepping down |
| **B. Reckoning** | `packages/shared/src/buddy/reckoning.ts` | the three checks of §6 |
| **C. Agenda** | `packages/shared/src/buddy/agenda.ts` | what this session still owes: beats plus parked topics |
| **D. Commitment** | `packages/shared/src/buddy/commitment.ts` | validate and shape the week being agreed |
| **E. Session** | `apps/api` — `/v1/buddy/session` | assembles context, runs the conversation, writes results |

### Generation tiers

`buddy_nudges.generated_by` is already `'template' | 'on_device' | 'cloud'`, with
a rate limiter (`buddy_llm_usage`) and telemetry (`buddy_llm_telemetry`) behind
`llm_tier`. The weekly session is a **cloud** surface — it needs retrieval and
real context — with a **template** tier as its permanent floor.

**Slice 1 is therefore not a prototype to be thrown away.** Shipping the ritual
with template copy builds the tier that afterwards serves every offline session,
every rate-limited session, and every LLM outage.

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
| **First ever** | Introduction, the frame question, and the disclosure that Buddy gets to know you over time | assuming context |
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

### Parked topics

A session may leave notes for the next one — a topic to pick up, a goal to
revisit. The Agenda function reads **owed beats plus parked topics**, so a
deferred crucial conversation is not special-cased: it is a parked topic carrying
a hard date. One mechanism, two uses.

### Drift is followed, never blocked

If the learner answers "how did the four days go?" by talking about a family
recital, Buddy goes there. That is not a detour: it is the **Draw out** beat
arriving early and better than Buddy could have asked for.

The only hard constraint is a **turn cap**, bounding cost and attention together.
As it approaches, Buddy closes on the commitment. Value proposed in §11.

### Duration, and asking for more of it

**Target feel: five minutes.** A pal checking in, not a performance review. Under
the template tier the same beats render as a short card sequence.

When the reckoning turns up something needing strategy, Buddy **asks for the
time** rather than taking it:

> *"There's something about November I'd like to talk through properly. Got
> fifteen minutes, or shall we pick it up next week?"*

Rules that keep the deferral honest:

- **Defer the conversation, never the fact.** If the learner says next week,
  Buddy still gives the one-line version — *"short version: November's looking
  tight at the current pace"* — and lets it go. A deferral that also suppresses
  the headline is how a learner arrives at November surprised.
- **Two deferrals, then it opens the session** (owner, 2026-07-30) — in the
  register of that script: state the situation, offer *both* dials, say plainly
  that a changed goal is fine, and ask what they are thinking.
- **The deadline can pull it forward.** Two weeks of silence is reasonable when
  November is four months out and is most of the runway in October. Whichever
  comes first.

### Elicitation is targeted, and refusals are permanent

Which question Buddy asks is a pure function of what the profile lacks, what has
already been asked, and what the learner declined. **A decline is permanent** —
matching how this app already treats "Not now" (Arc §3; the 7-day coaching
cooldown; the deleted immediate quick-check).

## 5. Data model

### 5.1 Columns and new tables

**On `user_profiles`:**

```
buddy_day            smallint  null      -- 0=Sun…6=Sat. null = no appointment
buddy_interval_weeks smallint  default 1 -- 1 = weekly, 2 = fortnightly
```

`reminder_hour` is **reused** for the time rather than adding `buddy_hour`: the
learner has already set an hour that suits them. If a weekend sit-down wants a
different hour than a weekday nudge, the first session can ask and the column
gets added then, knowing why.

`buddy_day` is nullable rather than defaulted, because null is meaningful — *no
appointment* — and is both the "when I ask" cadence of decision #9 and the
correct state for every existing user. Default when first offered is **the day
after `rest_day`** (owner, 2026-07-30); if `rest_day` is null, Buddy proposes a
day rather than picking silently.

**New — `buddy_commitments`:**

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
a broken promise would be Buddy holding someone to words they never said:

- missed `'session'` → *"we said four, you got two — what happened?"*
- missed `'rolled_forward'` → *"I kept last week's four going by default, and
  that may not have been the right call."*

**The outcome is derived, not stored.** What happened lives in `daily_stats` and
`review_logs` already. A stored score would be a second version of the truth,
free to drift from the first.

**New — `buddy_learner_facts`:**

```
id, user_id
fact         text          -- "spent summers near Oita"
kind         text          -- place | interest | routine | person | work | other
provenance   text          -- 'stated' | 'inferred' | 'imported'
confidence   real          -- meaningful only for 'inferred'
source_session_id uuid null
retracted_at timestamptz null
```

**`provenance` makes decision #6 enforceable rather than aspirational.** Without
it the rule is only a hope about prompt-writing.

**One fact per row: atomic, self-contained, independently meaningful.** Three
statements from one session become three rows — individually retractable, and
individually embeddable if that ever becomes wanted.

**New — `buddy_parked_topics`:**

```
id, user_id, topic text, note text
parked_in_session uuid null
raise_by date null            -- the deadline-bound case
resolved_at timestamptz null
```

### 5.2 Reused

| Table | Use | Today |
|---|---|---|
| `buddy_conversations` | transcript, `context='weekly_session'`; also the resume path (§8.3) | 0 refs; correctly shaped already |
| `learner_timeline_events` | `session_completed`, `commitment_set` — same pattern as `review_completed` | live, via `DualWriteService` |
| `learner_memory_artifacts` | the connections: `subject='kanji:説'`, `type='note'`, scored by `effectiveness_score` | 0 refs; exactly its design intent |
| `learner_profiles` + `learner_profile_universal` | structured spine, via the dual-write the profile route currently skips | app half live, UKG half unwired |

**Transcripts expire; facts persist.** `buddy_conversations` already carries
`expires_at`, and that is right — the conversation is ephemeral, what Buddy
*learned* from it is not.

**On the `subject` convention.** `subject` means *a thing being learned* — it is
constructed in exactly two places, both `kanji:${character}`
(`apps/api/src/services/buddy/dual-write.service.ts:124`, `:216`), and
`learner_knowledge_state`'s primary key is `(learner_id, subject)`. Buddy's
connections fit that convention unmodified. **Learner facts do not**, and a
`learner:` subject convention was rejected: it would put two incompatible
meanings of `subject` into a namespace `learner_knowledge_state` shares.

**On the profile pair.** `learner_profiles` (app-side, live — read by
`learner-profile.ts` and the tutor report) and `learner_profile_universal`
(UKG-side, zero refs) carry near-identical columns. That is not two designs; it
is one design whose mirror was never built. The structured spine therefore needs
no new table — it needs `PATCH /learner-profile` to go through
`DualWriteService` the way review submission does. That also answers "which one
does the session write?" before it can become a bug.

### 5.3 Embeddings — where, and where not

| | Learner facts | Connection library (§7.3) |
|---|---|---|
| Scope of a query | one learner | **all learners** |
| Corpus size | tens | unbounded, grows forever |
| Match type | load them all | **"Kyoto reader who visits Kyushu" ≈ "Beppu reader"** |
| When embedded | on write — user-facing | **at harvest — already async** |
| Verdict | **no embeddings** | **embeddings, from the start** |

Learner facts are not an embedding problem. Composing one learner's session loads
that learner's facts; at 10,000 users the table holds ~400,000 rows and every
query is `WHERE user_id = ?` returning about forty. The table grows; the searched
set does not. Embedding on write would also give a user-facing path a new way to
fail, for no retrieval benefit.

The connection library is the opposite on every axis, and tag matching genuinely
gives out there: "literature + travel + Kyushu" as tags misses "reads fiction,
has family in Oita," which is the same person for our purposes.

Two details that must be right from the first migration:

- **Store the model name beside every vector.** Embeddings are model-specific, so
  a model change means re-embedding — and without knowing which model produced
  which row you cannot do it incrementally or verify completion. Same principle
  as `provenance`: capture what cannot be recomputed.
- **Embed the ingredient signature, not the prose.** The matchable thing is what
  the connection is *about* — theme, place, vocabulary, the interest it serves —
  not the finished sentence, which is written for one learner and carries their
  name and their week.

### 5.4 Retired

- `study_plans` and `study_plan_events` — **superseded, dropped.** They store
  `activities[] + rationale + scaffold_level + expires_at +
  completed_count/skipped_count`: a *generated activity list*, which is the model
  decision #1 rejected. Ours is a learner-agreed weekly promise — different
  shape, lifecycle, and author.
- `study_log_entries` — **handed to Phase 6 untouched.** It is the Journal's
  table and the Journal is Phase 6's job.

### 5.5 Carried to the plan, not the spec

- **Verify against live before dropping anything.** None of the five dead tables
  appear in `packages/db/supabase/migrations/`; `0016`'s comments imply the UKG
  group exists by another route. What is in the live database is a question for a
  live session — and this repo's SOP says verify by content rather than assume.
- **RLS policies** for the new tables, following `0009` / `0018`.
- **`buddy_learner_facts` and `buddy_parked_topics` in the user-delete path.**
  Personal data by definition; a `user-delete` integration test already exists;
  exactly the kind of table that gets forgotten.

## 6. The reckoning and escalation

**One comparison, read three ways — and they are independent, which is the
point.**

| Check | Question | Outcomes |
|---|---|---|
| **Promise** | Did the week match what was agreed? | `kept` · `partial` · `missed` · `not_promised` |
| **Trajectory** | Does observed pace reach the target by its date? | `ahead` · `on_track` · `behind` · `no_target` · `insufficient_data` |
| **Frontier** | Does the placement posterior still describe this learner? | `outperforming` · `consistent` · `underperforming` |

They are separate because the interesting cases are where they disagree. **You
can keep your promise and still be behind** — the November conversation, which is
not a failure of effort but a mismatch between effort and ambition, an entirely
different discussion. **You can miss your promise and be ahead** — you
over-committed, and the honest fix is a smaller promise.

Collapsing these into one score is how you get a coach who congratulates you
while you drift, or scolds you while you are fine.

**Three rules keep it honest:**

- **Projection uses observed pace, never committed pace.** Projecting from the
  promise projects from a wish. What the learner did is data; what they said they
  would do is an intention.
- **No target means there is no such thing as behind.** `no_target` is not a
  degraded case to nag about. This is what stops the feature manufacturing
  deadlines for people who never wanted one.
- **Confidence is surfaced and unreachable is sayable** — both inherited from Arc
  §5B2. *"N2 by December isn't reachable at any sustainable pace — N3 is"* must
  be in range, because a planner that only ever agrees is a horoscope.

**Silence is the default.** Most weeks the **Raise** beat returns nothing — as
`selectInvitation` returning `null` is the common case in Arc §5C. Escalation
happens on two conditions only:

- `trajectory = behind` **and** a real target date → the crucial conversation,
  with the ask-for-time protocol of §4
- `frontier = outperforming` **and** the posterior's SE is wide enough for a
  retest to be informative → offer the retest

**The dials:**

| Dial | Column | Available |
|---|---|---|
| Minutes per day | `daily_goal` | now — **propose-and-confirm**, never written unilaterally |
| Days per week | `buddy_commitments.days_committed` | now |
| Time of day | `reminder_hour` | now — **Buddy asks rather than infers** |
| **The target itself** | date or level | now |

**Effort and target are offered as peers, in the same breath** (decision #11).

Time-of-day is worth one note: **the dial ships now, the smart version waits.**
*"Evenings don't seem to be landing — would mornings suit you better?"* needs no
behaviour model. *"You say evenings, but your evening sessions have a 40%
completion rate"* does, and that is Arc §12's deferred session.

## 7. Content and grounding

### 7.1 Salience, never enumeration

**Buddy answers from what is salient, not from what is stored.** Two or three
items, recent and relevant, then a question back — drawing across telemetry,
conversational memory, and the facts store, as a person would:

> *"Well, I know you've been studying a lot recently — your daily sessions have
> been regular and strong. And I remember we chatted about 説 last time. Is there
> something specific you're asking?"*

Applies to every retrospective question, not just "what do you know about me."
If the learner presses, Buddy goes deeper conversationally rather than switching
into a listing. **There is no query interface, and a dump on request would be a
catalogue with a conversational trigger** (decision #10).

**Consequence — retraction is a capability, not a reply.** When the learner says
*"forget that"* or *"that was my brother,"* the session must be able to write
`retracted_at` and correct the row. Otherwise "just ask Buddy" is a promise the
system cannot keep: Buddy says it will forget, nothing is written, and the wrong
fact returns in three weeks — worse than never offering. `retract_fact` and
`correct_fact` are session capabilities.

**The disclosure has a home:** the **First ever** opener says plainly, once, that
Buddy gets to know you over time. Never hidden; never catalogued.

### 7.2 The assertion ladder

| Claim | Source | Buddy may |
|---|---|---|
| **The learner said it** | `provenance='stated'` | assert plainly — *"you mentioned you spent summers near Oita"* |
| **Buddy worked it out** | `provenance='inferred'` | offer and check — *"you seem to do better in the mornings — does that match?"* |
| **A fact about the world** | not the learner's | **only from retrieval** — never from recall |

The third line came out of a live failure in this brainstorm, and the reason
belongs in the spec: the Murakami/Oita connection was *correct*, and was asserted
wrongly anyway — not because the model lacked the fact but because it could not
distinguish having it from constructing something plausible. A lookup settled it
in seconds. The rule is a sourcing requirement, not caution about culture, and
the failure it prevents is the expensive one: Buddy confidently wrong about the
learner's own country, taking the whole "Buddy knows things" premise with it.

### 7.3 The connection engine

The move, anatomised:

```
説  ── recently studied, and where a hook would help    [their data]
 └─ 小説  ── a word that uses it                         [dictionary]
     └─ a specific novel                                [WORLD FACT — retrieved]
         └─ partly set in Oita                          [WORLD FACT — retrieved]
             └─ Bucky studies in Beppu                  [their data — hook coordinates]
```

**Generation is a sibling of mnemonic generation, not a new subsystem.**
`MnemonicService.generateHaiku(kanjiId, userId, coords?)` already takes
coordinates and mnemonics already store `locationName`; location-aware generation
is an established pattern here. Same provider layer, same telemetry, same rate
limiting.

Ingredients:

| Ingredient | Source | Exists |
|---|---|---|
| Which kanji | recently studied **and where a hook would help** — low stability, recent lapse, no existing hook | yes — the co-creation trigger's selector |
| Vocabulary containing it | 小説 | yes |
| Confidence | FSRS state / posterior | yes |
| Stated interests | `learner_profiles.interests` | yes, currently unwritten-to |
| Place | hook coordinates | yes |

Choosing the kanji by *where a hook would help* makes the connection therapeutic
rather than decorative, and reuses logic already tuned for Buddy moments.

**Generate on demand, harvest to library.** The inputs are the learner's, so
generation is per-learner — but the verified world-fact half is not, so it is
harvested and tagged by its ingredients:

```
Bucky's session ─→ ingredients (説 · 小説 · literature+travel · Beppu)
                        ↓
                    search + verify
                        ↓
              connection statement ──→ used with Bucky
                        └─────────────→ harvested to the library
                                              ↓
                          Grant (Kyoto, visits Kyushu, reads) matches
```

**The library grows by use rather than being built ahead of it** — no cold-start
batch job, no guessing which of 2,254 kanji to pre-populate, and everything in it
has already been judged good enough to say to someone. Matching is semantic, per
§5.3.

**Preparation happens before `buddy_day`, never mid-conversation.** This is the
architectural dividend of the appointment being scheduled (§3): candidates are
assembled in the hours before the session, so a live search can never stall it.
Thematically right too — Buddy arrives having done some reading. If preparation
failed or found nothing, the **Connect** beat is skipped, which §4 permits.

### 7.4 Session location

Logging coarse location per study session is **designed in, with its own
consent.** This repo already splits `attach_location_to_milestones` from
`attach_location_to_hooks`, with a schema comment explaining why consenting to
one is not consenting to the other. Session-location is a third and a larger one:
hooks are occasional and deliberate, sessions are daily and passive — the
difference between "places I chose to tag" and "a log of where I am each day."

So: **its own toggle — `attach_location_to_sessions`, off by default — and
city-level granularity, not coordinates.** Beppu is all the connection engine
needs; lat/lng to five decimals is a movement history that would then have to be
defended. Stored coarse from the start rather than rounded later.

### 7.5 Tone

- **Specific over enthusiastic.** *"Five days, and you cleared the backlog"*
  beats *"Amazing work!"* — and only the first is evidence Buddy was paying
  attention.
- **No inflation.** A steady week praised like an exceptional one makes praise
  worthless, and the learner notices faster than you would think.
- **Buddy can be wrong out loud.** *"I had you down as an evening person —
  that's not right, is it?"* An inference offered as a question is correctable;
  asserted, it is just wrong.

### 7.6 Where copy lives

**Server-side**, per Arc §3 — so Buddy's voice changes without an EAS build,
which matters when tone will want a dozen passes and builds are budgeted. English
only, structured for localization but not localized (Arc §6). The template tier's
copy is a catalogue; the cloud tier's is a system prompt plus assembled context.

## 8. Failure paths

### 8.1 The learner does not come

| | Rule |
|---|---|
| **Misses one** | Commitment rolls forward as `source='rolled_forward'`. Next opening is the **Absent** register — warm, no accounting — and the reckoning does not score a promise never made. |
| **Opens late** | A session belongs to the week that ended. Past the midpoint to the next `buddy_day`, the week is skipped and the next is fresh. Two sessions never cover one week — `unique (user_id, week_start)` enforces it in the schema, not just the code. |
| **Gone for weeks** | Not a missed appointment, a **return.** Different opener, no back-accounting of skipped weeks. |
| **Never set `buddy_day`** | Day after `rest_day`; if that is null too, Buddy proposes rather than picking silently. |

**Step down before they mute you.** After **three consecutive missed
appointments**, cadence drops automatically — weekly → fortnightly → when-you-ask
— and **Buddy says so**: *"I'll stop showing up weekly — give me a shout when you
want to pick this back up."*

This is the designed exit from decision #9. There is no off switch, but a learner
who has had enough must get relief without going to iOS Settings, because that
exit is silent and teaches us nothing. A step-down is legible: we learn they
stepped back, they keep the rest of the app, and returning is one tap.

### 8.2 The data is not there

None of these degrade to nagging:

- **No target** → `trajectory = no_target`. Never "behind."
- **No placement** → `frontier = insufficient_data`. No retest offers at all,
  rather than offers based on a guess.
- **Too little history** → projection `rough` and labelled, or absent.
- **First-ever session** → not degraded, *different*: introduction, frame
  question, disclosure, and a first commitment with nothing to reckon.
- **No connection prepared** → **Connect** skipped silently.

### 8.3 The machinery fails

| Failure | Behaviour |
|---|---|
| **LLM unavailable or rate-limited** | Falls to the **template** tier. Same five beats as cards, commitment still set. |
| **Connection prep failed or empty** | Skip the beat. Never ship an unverified claim to fill a slot. |
| **Retrieval returned something shaky** | Skip. §7.2 makes silence strictly better than a hedged world-fact — the hedge does not protect the trust it spends. |
| **Session interrupted** | Resumable from `buddy_conversations` (`messages`, `last_active_at`, `expires_at`). After expiry, a fresh session. |
| **Offline** | The session waits. **But the roll-forward is server-side and must not depend on the device being reachable** — the week is set whether or not the phone connects. |

### 8.4 The learner pushes back

- **"Not now."** A decline in the app's existing grammar — permanent for the
  topic, cooldown for the ritual, never re-asked in the same session.
- **"Leave me alone."** Immediate step-down. No negotiation, no retention prompt.
- **Chronic over-commitment** — five days promised, two delivered, three weeks
  running. **Not a failure path; the best coaching moment in the design.** Buddy
  proposes *three*. A Buddy that cannot suggest doing less is a nag with good
  manners.
- **Unreachable target.** Say so (§6) and offer both dials.
- **Goals changed.** Normal. Retarget and move on.

### 8.5 One repo-specific hazard, stated because it already happened

**`buddy_day` is a day in the learner's timezone, and this codebase has been
burned by exactly that.** `user_profiles.timezone` carries a `'UTC'` default that
nothing ever wrote from a client — the root cause of daily reminders firing at
the wrong hour for three months, still recorded in the schema comment at
`packages/db/src/schema.ts:171`.

So: **a learner whose timezone is still the `'UTC'` default has no reliable
`buddy_day`.** Either the appointment waits for a real timezone, or it is
explicitly best-effort and known to be so. Plan 4 Task 17 fixed the capture path;
whether every existing row is backfilled is a live-data question, and it is the
difference between this working and it quietly firing on the wrong day.

## 9. Testing

**Four pure components carry the real logic** — `appointment`, `reckoning`,
`agenda`, `commitment` — in `packages/shared`, tested in the pure lane with an
injected `now`.

The cases that matter are the **disagreements**, because that is why §6's checks
are separate:

| Case | Must produce |
|---|---|
| Promise `kept` + trajectory `behind` | the November conversation, no scolding |
| Promise `missed` + trajectory `ahead` | a *smaller* proposed commitment, no alarm |
| `not_promised` + missed | no broken-promise register at all |
| `no_target` + any pace | trajectory silent, never "behind" |

**A test that guards a rule must be shown to fail when the rule is removed.** The
B-210 regression test passed with the never-overwrite protection deleted
entirely — its fixture could not reach the path it claimed to guard. So every
guard test here carries a **control assertion** proving the path executed, and
the plan's verification step is to delete the rule and watch the test go red. A
test that cannot fail is worse than no test, because it is counted.

**API integration** — session assembly and writes, the profile dual-write (both
halves or neither), `retract_fact` actually writing `retracted_at`, RLS on the
new tables, and the new tables in the user-delete path. Bare `x-test-user-id` per
this repo's convention, and **rebuild the local test DB first**.

**Component lane** — the session screen's render states: loading, template-tier
cards, live conversation, offline, interrupted-then-resumed.

**Test the scaffolding, never the words.** Assert that the right context was
assembled, the right capabilities exposed, the right beats marked satisfied, the
turn cap fired. Do not assert what Buddy said — a test that pins model output
breaks on every prompt improvement and passes on every regression that keeps the
shape.

**Tone is reviewed, not asserted.** A handful of real transcripts read by the
owner is the only instrument that works on "does this sound like a pal."

**Needs a device:** the `buddy_day` push arriving, on the right day, in the right
timezone. Given §8.5, not optional.

**Blocked locally:** the local test DB holds 7 kanji, so connection generation
and anything needing a real deck skips with explicit preconditions rather than
flaking.

## 10. Slices

### Slice 1 — The ritual

`buddy_day` · `buddy_interval_weeks` · `buddy_commitments` · `appointment` and
`commitment` pure functions · promise check only · template-tier session as cards
· the `buddy_day` push · **server-side roll-forward** · the step-down.

No LLM, no facts, no connections. **Ships value alone:** the learner sets a week
with Buddy and the next week reviews it — and it builds the template tier every
later failure path falls back to.

### Slice 2 — The conversation

Cloud tier · `buddy_conversations` · `buddy_learner_facts` + the seeding pass
over hooks, onboarding and hook locations · `buddy_parked_topics` · profile
dual-write · elicitation · `retract_fact` / `correct_fact` · trajectory and
frontier checks · escalation and the ask-for-time protocol.

**One dependency named now: trajectory needs a stored target with a date, and
nothing stores one.** The Arc spec designs the planner (§5B2) but it is not
built. Rather than block, **slice 2 captures the target conversationally** —
*"what are you aiming for, and by when?"* — which is the natural place to ask.
The planner's richer half (invert the projection, compute required effort) lands
later against a target that already exists.

### Slice 3 — The connection engine

Connection generator as a `MnemonicService` sibling · retrieval and verification
· the harvest library with pgvector, per-row model tagging, and ingredient-
signature embeddings · the pre-`buddy_day` preparation job · session-location
consent, coarse.

Day one has data: hooks already carry coordinates, so this does not wait on new
collection. Session-location is an enhancement shipped **with its use** rather
than ahead of it.

### Cross-cutting

An edit to the Arc spec in three places (§5A, §5B2, §12), pointing each orphan at
its new home — what keeps the two specs one system rather than two overlapping
ones.

## 11. Open items

1. **Turn cap value.** Proposed: **~14 exchanges** for a standard session and
   **~30** for an accepted crucial conversation, both soft — Buddy begins closing
   on the commitment rather than cutting off. Needs confirmation once a real
   transcript exists; it is a tuning number, not a design decision.
2. **Embedding provider.** Anthropic does not offer embeddings, so this is a new
   dependency: Voyage, OpenAI's small embedding model, or a Supabase Edge
   Function running a local model — a shape this project already has muscle
   memory for. pgvector is available on Supabase either way. Named as an explicit
   choice rather than assumed.
3. **When the first session is offered** to a brand-new learner — immediately
   after onboarding, after a first week of study, or at a first milestone. The
   first session is the home of Frame's `ask`, which argues for early; a session
   with nothing to reckon argues for after some study.
4. **Whether `buddy_interval_weeks` needs a third state** beyond 1 and 2, or
   whether `buddy_day = null` covers "when I ask" adequately.
