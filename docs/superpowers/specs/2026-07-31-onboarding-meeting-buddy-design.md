# Meeting Buddy — onboarding as a conversation (Phase 7)

**Status:** design complete, unplanned
**Date:** 2026-07-31
**Replaces:** `2026-04-13-onboarding-tutorial-questionnaire-design.md`, and the
roadmap's Phase 7 in `2026-04-09-kanji-buddy-spec.md`
**Pairs with:** `2026-07-31-buddy-home-notebook-design.md` (Phase 6) — the two
ship together; this one writes page one of the notebook that one defines.

---

## 1. What this is

Onboarding today is a five-step form — Welcome, Find Help, About You, Focus,
Daily Target — 680 lines of stepper, ending in `router.replace('/placement')`.
Buddy does not appear in it.

It becomes **the first meeting with Buddy**: he introduces himself, orients the
learner, asks why they are here, negotiates when they will meet each week, and
closes by asking them to take a placement test before that first meeting.

---

## 2. Design decisions

| # | Decision | Why |
|---|---|---|
| 1 | **A real conversation, not a narrated form.** | Buddy is a character the learner will meet every week for months. A voice-over on a stepper introduces a mascot; a conversation introduces a relationship. Owner's call, 2026-07-31, with the drop-off risk stated and accepted. |
| 2 | **Placement moves to the END and is not a gate.** | Owner: *"Let's get as much as we can from this first interaction without the weight of a placement test in the middle."* A test in the middle interrupts the one conversation that has to carry the relationship. |
| 3 | **Placement is framed as the first thing Buddy asks of the learner**, to be done before the first weekly meeting. | *"As soon as you can complete a brief placement test I can prepare a specific plan to reach your goals. We are in this together."* This is why the first weekly session exists — Buddy has already said what he will do with the result. |
| 4 | **Deferring placement strands nobody.** | `srs.service.ts` orders new kanji by `asc(jlptLevel), asc(jlptOrder)`, so a learner with no progress rows starts at N5 and studies normally. Placement is an accelerator, never a prerequisite. |
| 5 | **The conversation has required outputs and cannot end without them.** | A spine would guarantee them by construction; a free conversation must guarantee them by extraction plus a completeness check. Without it, onboarding ends and the rest of the app has no ruler, no goal, and no appointment. |
| 6 | **A template-tier floor, always.** | First launch is the worst possible moment for a network failure. The same permanent floor slice 1 established: nobody is ever stuck at a spinner on their first screen. |
| 7 | **Everyone meets Buddy, not only new sign-ups.** | `buddy_day` is `NULL` for every existing learner — the open decision left by the slice shipped 2026-07-31. New-users-only would leave the entire current user base with an appointment feature they will never find. |
| 8 | **Frame's `ask` moves into this conversation.** | The Arc design routes `resolveFrame` → `ask` when stated reasons are ambiguous, and parked that `ask` in the first weekly session. Asking why you are here is the natural centre of a first meeting, and it is a strange thing to defer a week. |

---

## 3. The shape of the conversation

Beats, not steps. Buddy moves through them; the learner may answer several at
once and Buddy must not re-ask what he already has.

1. **Introduction.** Who Buddy is and what he is for.
2. **Core orientation.** How this works: you study daily, we meet weekly, and
   there is a notebook that holds what we decide. This is where Phase 6 is
   foreshadowed — the learner should recognise the notebook when they first open
   it, because Buddy described it.
3. **Why are you here.** Reasons and interests. Feeds `resolveFrame` → ruler;
   this is Frame's `ask`, asked in the one place it belongs.
4. **What that means for us.** Focus and daily target, proposed by Buddy from the
   answers rather than presented as a blank field.
5. **When shall we meet.** `buddy_day` and `buddy_interval_weeks`, negotiated —
   Buddy proposes a day, the learner counters. Rest day is deliberately not
   conflated with it (Phase 6 spec, decision #8 of the weekly review design).
6. **The ask.** The placement invitation, and the promise of what it buys.

---

## 4. Required outputs

Onboarding cannot end without: `reasons`, `interests`, `focus`, `dailyGoal`
(minutes), `buddyDay`, `buddyIntervalWeeks`, `timezone`.

Guaranteed by three mechanisms, in order:

1. **Structured extraction** from the exchange, not from form fields.
2. **A completeness check** — a pure function over collected state returning the
   next unmet requirement, or `null`. Buddy keeps going while it returns
   something. Testable with no model in the loop.
3. **A skip-to-form escape.** Anyone who will not converse gets the existing
   stepper, which still works and still writes the same fields. The conversation
   is the front door, not the only door.

`timezone` is captured by the existing `deviceTimezone()` sync, not asked.

---

## 5. Existing learners

The conversation runs for everyone on next launch, skipping beats whose data is
already on file. A learner who already stated reasons and a daily goal meets
Buddy, gets the orientation, negotiates `buddy_day`, and gets page one — without
being re-asked what they already answered.

Skippable, and re-enterable later from Profile. Completion is recorded so it does
not re-prompt.

---

## 6. Page one

At close, onboarding writes the notebook's first entries:

- Buddy's introduction, under **What Buddy notices** — authored `buddy`.
- The appointment, under **What we've settled** — the day, the interval, and
  that the learner chose it.
- Reasons and focus, under **What we've settled**.
- **No agreement.** That is negotiated at the first weekly session, against a
  placement result that exists by then. "The agreement" reads as anticipated,
  with Buddy having said what goes there and when.

---

## 7. Tiers

| Tier | Behaviour |
|---|---|
| Cloud | Full conversation, structured extraction |
| Template | Fixed beats with the same required outputs and the same page-one writes |

The template tier is not a degraded experience to apologise for. It is the floor,
and every offline, rate-limited and outage path lands on it.

---

## 8. Data model

No new tables. Writes existing fields on `user_profiles` and `learner_profiles`,
plus `notebook_entries` from the Phase 6 spec.

One addition: a completion marker so the conversation does not re-prompt —
`user_profiles.met_buddy_at` (timestamptz, nullable). Nullable is the correct
state for every existing row, exactly as `buddy_day` was.

---

## 9. Edge case: placement after study has begun

A learner who studies for a week and *then* places will already have
`user_kanji_progress` rows for kanji placement wants to seed. Seeding writes rows
with `total_reviews = 0`; **it must never overwrite a row carrying real review
history.** This could not happen before, because placement always ran first.

---

## 10. Testing

- **Pure**: the completeness check, beat selection given partial state, the
  skip-beats-already-answered logic for existing learners.
- **Component lane**: the conversation surface, the skip-to-form escape, the
  template-tier fallback.
- **API integration**: page-one writes, `met_buddy_at`, and a **read-back
  assertion on every field** — `z.object()` strips unknown keys, which has cost
  this project four inert features once and recurred as Task 11 on the
  weekly-review branch.
- **A test proving the seeding collision in §9 does not overwrite history**,
  demonstrated red against the guard removed.
- Every guard demonstrated red. For any threshold, a test proving the
  non-default branch executes.

---

## 11. Open items

1. **How long the conversation should be.** Long enough to establish a
   relationship, short enough that first-launch drop-off does not spike. Needs a
   real transcript, not a guess.
2. **Whether Buddy should re-ask a skipped beat later**, or let it stay unknown
   and infer.
3. **Whether existing learners see the orientation beat** or only the parts that
   produce missing data. Leaning toward showing it — the orientation is the part
   that makes the notebook legible — but it is the beat most likely to annoy
   someone mid-habit.

---

## 12. Out of scope

- Voice input (weekly-review modality decision: text now, learner choice later).
- The weekly session itself — shipped as slice 1, conversation is slice 2.
- Any change to the placement test's content or scoring.
