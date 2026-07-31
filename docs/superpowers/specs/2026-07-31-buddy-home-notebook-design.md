# Buddy's Home — the shared notebook (Phase 6, replacing "Study Log")

**Status:** design complete, unplanned
**Date:** 2026-07-31
**Replaces:** Phase 6 — Study Log, as defined in the roadmap of
`docs/superpowers/specs/2026-04-09-kanji-buddy-spec.md`
**Builds on:** `2026-07-30-weekly-buddy-review-design.md` (slice 1 shipped
2026-07-31), `2026-04-13-tutor-analytics-sharing-design.md` (live)

---

## 1. What this is

The Journal tab today is a searchable catalogue of mnemonics — 389 lines titled
"Mnemonic Journal". It becomes **Buddy's home**: the place Buddy and the learner
meet each week, and the durable record of what they have decided, what they are
trying, and what is working.

It is a **document**, not a dashboard and not a feed. It opens as a page with
prose on it.

### 1.1 Why the roadmap's Phase 6 is replaced rather than revised

Phase 6 was specified as `study_log_entries` plus photo upload, audio recording,
and timeline / map / kanji / tag / mood views — a **media scrapbook of study
moments**. What this spec describes is a **working record of a relationship**.
They share a tab and nothing else. One does not evolve into the other, and
keeping the old table around is an invitation to "finish" a product that has
been decided against.

`study_log_entries` and `study_log_mood` are dropped: zero rows on live, zero
consumers anywhere in the codebase.

---

## 2. Design decisions

| # | Decision | Why |
|---|---|---|
| 1 | **A document, not a dashboard.** | Four of five sections are empty at week zero. Five panels showing nothing reads as a broken app; a short page reads as an early relationship. The space must be dignified when nearly empty, which is the state every learner is in for their first month. |
| 2 | **Joint authorship — the learner can edit anything Buddy wrote.** | A document titled "observations about you", authored entirely by an AI and revised weekly without your input, is a clinical file. Same data, different authorship, entirely different feeling. |
| 3 | **Editing is superseding.** | `buddy_commitments` already works this way — one row per period, `superseded_at`, `source`. A second history model in the same document would be two truths about the past. |
| 4 | **The supersede chain is how Buddy stays honest.** | Under joint authorship Buddy must distinguish *"the learner corrected me"* from *"I wrote that myself last week"*. Without it he feeds his own output back as learner-supplied fact and drifts on it. A `learner`-authored row superseding a `buddy`-authored row **is** the correction signal — which wires slice 2's `retract_fact` / `correct_fact` to the ordinary edit and delete controls rather than leaving them as tools Buddy calls on himself. |
| 5 | **The notebook is mostly a projection.** | The agreement, experiments and hooks already have production tables. Copying them into a generic entry store puts one fact in two places and breaks the weekly-review spec's decision #5 — pure functions branch on typed fields, prose lives in rows only the model reads. |
| 6 | **Cadence shows state and control, never the tally.** | A counter reading "2 of 3 missed" appears on a screen the learner opens when already feeling behind. This feature's premise is effort and method, never volume, *specifically* so there is nothing to fail at. Showing where they stand in a step-down rule reintroduces the compliance number the design exists to avoid. |
| 7 | **The tutor is a third author whose entries nobody else can supersede.** | An AI revising a paid human expert's note is the one edit that must be impossible. |
| 8 | **Tutor notes are never translated by default.** | Owner, 2026-07-31: a tutor may write in Japanese *deliberately*, to challenge the learner to read it. Auto-translation destroys the pedagogical intent. In an app that teaches Japanese, a note from your tutor in Japanese is the highest-value reading material available — authentic, current, and about you. |
| 9 | **Buddy needs no translation to reason over a tutor note.** | The model reads Japanese natively. Translation was only ever for the learner, and the learner is the one party who may want the challenge. |
| 10 | **Any live tutor note turns an experiment proposal into a question.** | Detecting *semantic contradiction* needs a model call: non-deterministic, untestable, and it fails in the worst direction — silently concluding there is no conflict. A blunt rule is a pure function, and it errs toward deferring to the human. |
| 11 | **The notebook renders on the template tier.** | Slice 1 is deliberately LLM-free and that tier is the permanent floor every offline, rate-limited and outage path falls back to. Buddy's observations come from deterministic triggers with template copy; the cloud tier words them better, never carries them. |

---

## 3. Structure

One living document per learner. Six sections, each with a live state and an
archive. The sixth appears only when a tutor share exists.

| Section | Holds | Live | Archive |
|---|---|---|---|
| **The agreement** | days, minutes, method, focus | exactly 1 | past agreements |
| **What we're trying** | one method change, proposed week N, judged week N+1 | 0 or 1 | past experiments with verdicts |
| **What Buddy notices** | hook efficacy, per-dimension weakness, trajectory | a handful | superseded observations |
| **What we've settled** | durable, non-week-scoped agreements | a handful | reversed decisions |
| **From your tutor** | tutor notes, as written — **one section per accepted share** | a handful | older notes |
| **Your hooks** | the mnemonic catalogue, as today | all | — |

**"From your tutor" is per share, not per learner.** Two tutors produce two
sections, each titled with that tutor, because §5.1 keys notes by `share_id`
precisely so two voices never merge. A learner with no accepted share sees no
such section at all — which is most learners today (three shares, one note), and
is why it must be absent rather than empty.

**Cadence is not a section.** It is a status line in the header — *"Buddy checks
in weekly, on Sundays"* — with a control to change it. This gives today's silent
step-down its first visible home: the hourly pass currently steps a learner from
weekly to fortnightly to off and tells them nothing.

**"What we're trying" needs no new machinery.** `buddy_commitments.experiment_until`
shipped 2026-07-31, and the weekly-review spec's decision #13 already defines an
experiment as proposed-in-N, measured-in-N+1. The section is a projection of
columns already in production.

---

## 4. Authorship and rights

| Author | Can write | Can supersede |
|---|---|---|
| Learner | yes | own entries, and Buddy's |
| Buddy | yes | own entries only |
| Tutor | yes | own entries only — **nobody else can supersede a tutor note** |

The learner may **respond** to a tutor note with their own linked entry. They may
not overwrite it.

---

## 5. Data model

### 5.1 Projections — no new storage

| Section | Source |
|---|---|
| The agreement | `buddy_commitments`, live row is `superseded_at IS NULL` |
| What we're trying | `buddy_commitments.experiment_until IS NOT NULL` |
| Your hooks | `mnemonics` + `effectiveness_score` / `reinforcement_count` |
| Tutor notes | `tutor_notes` joined to `tutor_shares` |

Tutor notes stay keyed by `share_id`, not `user_id`. **A learner with two tutors
keeps two distinct voices rather than a merged blur.**

The *view* has three authors. The entries table has two.

### 5.2 New table — `notebook_entries`

| Column | Notes |
|---|---|
| `id` | uuid pk |
| `user_id` | FK `user_profiles` on delete cascade |
| `kind` | `observation` \| `decision` |
| `body` | text |
| `author` | `buddy` \| `learner` |
| `week_start` | nullable — which session produced it |
| `source` | jsonb — the evidence, e.g. `{kind:'hook_efficacy', mnemonicId}` |
| `created_at`, `superseded_at`, `superseded_by` | self-FK supersede chain |

RLS **enabled and forced**, with both the authenticated-user and service-role
policies. Migration `0030` on the weekly-review branch enabled without forcing
and hid behind a summary count in `rls-coverage`; that is not repeated here.

### 5.3 Tutor schema additions

- `tutor_shares.language` — the tutor's language, captured at invite or accept.
  Drives the **outbound** report only (a Japanese tutor reading about their
  student in Japanese). It does **not** drive inbound translation.
- `tutor_notes.language` — the language the note was written in.
- `tutor_notes.body_translations` jsonb — cache, populated **only** when a
  learner explicitly asks for a translation. Never on write, never on read.

### 5.4 Assembly is a pure function

`assembleNotebook(state) → NotebookView` in `packages/shared`, no database.
Ordering, archive partitioning and empty-state selection are all testable
without a fixture, mirroring `buddy/appointment.ts` and the co-creation reducer.

---

## 6. The tutor's voice

### 6.1 Notes render as written

No translation by default. `GET /v1/tutor-sharing/notes` already authenticates
as the **learner**, so surfacing notes in the notebook is not a new disclosure —
it gives existing but buried content a home.

### 6.2 A note is a study surface, not an obstacle

Tapping any kanji in a tutor note shows its reading, meaning, and **the
learner's own hook for it**. TTS reads the note aloud. All three already ship:
`/v1/kanji/lookup?character=`, the mnemonics store, `expo-speech`.

Translation is a deliberate escape hatch. When used, **the note records that it
was used** — visible to the learner and to Buddy. Taking the shortcut is a fact
about the learner's reading, and hiding it from the record would make the
notebook less honest than the learner.

### 6.3 Deference

A tutor note is *live* while unsuperseded. `checkTutorConstraint(experiment,
liveTutorNotes) → 'propose' | 'ask'` is a pure function containing no model
call. Any live note yields `'ask'`.

If that proves too blunt once real notes exist — one row across three shares
today — tightening it is a later slice with evidence behind it.

---

## 7. The weekly session writes back

At session close the session produces a commitment and at most one experiment
(both existing), plus observations.

Observations are written as `notebook_entries` from **deterministic triggers**:
an effectiveness score crossing a threshold, a per-dimension drill diagnosis, a
trajectory change. `source` records the evidence. Template copy on the template
tier; better wording, never different substance, on the cloud tier.

---

## 8. First open

Section 3 leans on onboarding (Phase 7) writing page one — Buddy's introduction,
the `buddy_day` negotiation recorded under "What we've settled", the first
agreement seeded from the placement result.

**If Phase 6 ships before Phase 7, that safety net does not exist** and every
existing learner opens a blank document. Phase 6 therefore carries its own seed:
a single Buddy-authored introduction written on first open for any learner
without one. Small, but it is the difference between a considered first
impression and an empty page — and it is the kind of thing discovered on a
device rather than in a spec.

---

## 9. Boundary with Progress

**Progress is evidence. The notebook is meaning.**

Progress keeps the numbers — Kanji Breakdown, Milestones, Activity, Confidence,
Velocity, Quiz Performance, Writing Practice, Session History, Speaking Practice
— and gains no interpretation. The notebook holds what those numbers *mean* and
links into Progress for the chart behind a claim.

The mnemonic catalogue **stays in the notebook**: hooks are things Buddy helped
make, and their efficacy is something he reasons about.

### 9.1 Quiz Weak Spots is retired, not improved

It renders kanji most missed in quizzes, minimum 3 attempts, as a miss-rate bar.
Two faults:

1. **It is a dead end.** It names specific kanji and offers no action — no
   tap-through, no link to the hook, no drill. Every other panel is a number you
   read; this one names items and abandons you. A weakness list with no action is
   a guilt list.
2. **It is quiz-only while named as the whole thing.** A kanji reliably failed at
   *writing* but recognised in a quiz never appears — with Writing Practice and
   Speaking Practice panels sitting alongside, proving the other dimensions are
   tracked.

The weekly-review spec §10 already designs **per-dimension drill diagnosis** as a
`groupBy` change on the existing weak-kanji queue. That is the honest version,
and it belongs where something can act on it.

---

## 10. Conversation modality

**Text now.** Typed exchange driven by the spine, as slice 2 is already designed,
with the ~14-exchange soft turn cap. The transcript is the notebook entry.

**Learner choice later**, including voice. Both halves already ship —
`expo-speech` and `expo-speech-recognition` — but the existing STT recognises
short, constrained *Japanese* utterances scored by Levenshtein against a known
target. A weekly review is open-ended dictation in the learner's **native**
language with no expected answer and no way to score a misrecognition. The
commitment is numbers: "four days, fifteen minutes" misheard as "forty days"
silently corrupts the one output the session exists to produce.

Voice becomes its own slice once a real transcript exists to tune against.

---

## 11. Error handling

- **Offline is read-only.** The assembled view is cached and `OfflineBanner`
  shows; edits are refused with a clear message rather than queued. A sync queue
  for a weekly-cadence document is machinery for a problem that does not exist,
  and a half-built one silently loses edits.
- **Conflicts need no locking.** Two concurrent edits produce two rows; the later
  wins and both remain in the archive. Nothing is lost and there is nothing to
  resolve.
- **Translation failure never blocks the notebook.** The note renders in its
  source language with a marker.

---

## 12. Testing

- **Pure** (`packages/shared`): `assembleNotebook`, archive partitioning,
  `checkTutorConstraint`, translation-cache selection.
- **Component lane**: the three states that bite — zero entries, tutor note
  present, offline.
- **API integration**: the supersede chain, RLS coverage, and a **read-back
  assertion on every field the client sends.** `z.object()` strips unknown keys;
  that has cost this project four inert features once and recurred verbatim as
  Task 11 on the weekly-review branch. Asserting 200 is what failed to catch it
  both times.
- **Every guard demonstrated red** against the removed rule. The constraint
  "every guard test carries a control assertion" was not enough on the last
  branch.
- **For anything with a threshold, a test proving the non-default branch runs.**
  On 2026-07-31 a placement scale bug reached production data because the fitted
  branch was structurally unreachable from the test database — 10 rows against a
  300-row minimum — so every test ran the fallback. A guard whose safe path is
  the only tested path is not tested.

---

## 13. Migration

- Create `notebook_entries` with RLS enabled **and** forced, plus both policies.
- Add `tutor_shares.language`, `tutor_notes.language`,
  `tutor_notes.body_translations`.
- Drop `study_log_entries` and the `study_log_mood` enum.

---

## 14. Open items

1. **How many observations stay live** before ageing into the archive. A number
   to tune against real sessions, not to guess once.
2. **Whether a learner-superseded Buddy observation should suppress the trigger
   that produced it.** If Buddy notes a hook is failing and the learner deletes
   it, does the same observation return next week? Leaning yes-with-decay, but it
   needs a real case.
3. **Where the tutor authors from.** Tutors have a token web view, not the app.
   Any richer authoring surface is a separate build and is not scoped here.
4. **Whether the outbound report should eventually become a rendering of the
   notebook** rather than a separately generated artifact — considered and
   deferred, since it puts a live feature's output on a new build's critical
   path.

---

## 15. Out of scope

- Voice conversation (§10) — its own slice.
- The Japanese-localised tutor report — piece **A**, independent, and unblocked
  by this.
- Phase 4 Social Learning scope refresh — piece **B**.
- Progress refinements: burstiness on the Activity chart, item-type fidelity in
  Quiz Performance — piece **E**. Only the Weak Spots retirement (§9.1) is
  scoped here, because it is a consequence of the boundary decision.
