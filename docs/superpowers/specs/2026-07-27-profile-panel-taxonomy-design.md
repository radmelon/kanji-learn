# Profile Page Panel Taxonomy — Design

**Date:** 2026-07-27
**Status:** Design approved; implementation plan not yet written
**Origin:** Owner report — *"I find myself often searching for the About & License page link and it is buried half way down the profile page."*

---

## Problem

The Profile screen has eleven sections whose order looks accreted rather than
decided. The reported symptom is that **About & Licences sits 7th of 11**, but
that is not the whole failure.

Its parent section, **"App"**, pairs *Placement Test* — an action that launches a
study activity — with *About & Licences*, a static info link. The heading
predicts neither, so scanning fails **even once you are looking at the right
region of the page**. Position alone would not explain repeated failure to find
something you have already scrolled past.

The same problem appears twice more. Related settings are split across unrelated
neighbours:

- **Display Name** (1) and **Learning Profile** (8) both describe the learner,
  separated by six unrelated sections.
- **Daily Review Goal** (2) and **Study Preferences** (5) both configure study,
  separated by Notifications and Privacy.

## The reframe: the sections are wrong, not just their order

The first framing of this work was "decide an ordering rule for the eleven
sections". The owner rejected it, correctly:

> *"I think we should first decide if 11 panels as named is right. My sense is
> that no, the existing 11 panels are not the right set of groupings."*

The existing sections are named after **implementation categories** —
"Notifications", "Privacy", "App" — not after anything a learner is trying to
do. Reordering them makes a wrong taxonomy tidier. The fix is to re-derive the
panels from meaning.

**Evidence the current grouping follows the subsystem rather than the meaning:**

- *"Privacy"* contains exactly the two settings that write GPS coordinates. They
  are grouped by **mechanism**. By purpose they are about what Buddy notices and
  remembers.
- *Mnemonic coaching* lives under Study Preferences because it is a study-domain
  feature. What it actually governs is **whether Buddy interrupts you** at
  Session Complete.
- *Rest day* lives under Notifications because reminders consume it. What it
  actually describes is **your study rhythm**.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Optimise for **predictability**, not frequency | The complaint is a findability failure. Frequency-first ordering would push About *further* down and fix none of the split adjacencies. |
| D2 | **Visible panels**, not implicit ordering | "Predictable" only works if clusters are perceivable. Resolved for free by D3: five conceptual panels *are* five sections, so no second visual level or new component is needed. |
| D3 | **Re-derive the panels** — 11 → 5 | See reframe above. |
| D4 | A **distinct Account panel** | Gives the anticipated BYOK LLM key an obvious home *before* it exists, and keeps credentials away from learning settings. |
| D5 | **Concentric ordering** | Stated rule below. Puts About at a permanent extreme — findable without remembering an order. |
| D6 | **Mixed naming** — explanatory where non-obvious, plain where self-evident | Limits the Buddy-voice commitment to the two labels that earn it. |
| D7 | **Retake ships separately**, gated on B-210 | See "Placement test" below. |

## The ordering rule

> **Ordered by distance from the daily act of studying: how I learn, how Buddy
> behaves, who else is involved, then my account and the app itself — with the
> rare and the irreversible last.**

The rule must be statable in one sentence, because a rule nobody can recall is
indistinguishable from no rule — which is the state being fixed.

An earlier draft phrased this as *"start with you and your learning, move
outward to other people, then to the app itself"*, which does not survive
contact with the actual order: **My account** is unambiguously about *you*, yet
sits at position 4, after other people. It is late because it is rarely touched
and contains the two irreversible actions, not because it is "outward". The
phrasing above is the honest one.

Note the counter-intuitive consequence, which is deliberate: **About & Licences
moves *down*, not up.** The fix for "I keep hunting for About" is a *predictable*
home — the end of the page, permanently — not promotion above settings that are
changed far more often. Optimising the reported symptom directly would degrade
the common cases.

## The taxonomy

| # | Panel | Contains | Drawn from |
|---|---|---|---|
| 1 | **How I learn** | Daily review goal · rest day · pitch accent · country · what I'm focused on · my interests · my placement level | Daily Review Goal, Study Preferences, Learning Profile, part of "App" |
| 2 | **How Buddy reaches me** | Daily reminder on/off · reminder time · mnemonic coaching · remember where I earned a milestone · remember where I built a hook · Apple Watch | Notifications, Privacy, part of Study Preferences, Apple Watch |
| 3 | **Study Mates & Tutors** | Study Mates · Share with Tutor | unchanged, merged |
| 4 | **My account** | Display name · *(reserved: my AI account)* · Sign out · Delete account | Display Name + the loose buttons at page end |
| 5 | **About KanjiBuddy** | Acknowledgements & licences · *(future: how-to guides, technical details)* | "App" |

### Three sections disappear as concepts

- **"Privacy"** — its two switches were grouped by mechanism; by purpose they
  belong to panel 2. Privacy stops being a *place* and becomes a property
  described where the decision is actually made.
- **"App"** — a grab-bag; its two rows go to opposite ends of the page.
- **"Notifications"** — becomes the broader idea of how Buddy reaches you, which
  correctly makes the Watch a **channel** alongside push rather than a separate
  feature. This anticipates the Watch reconceptualisation (motivator, not tiny
  flashcards — operator, 2026-07-04).

### Two settings move to the other side

Both are cases where the current home reflects the implementing subsystem:

- **Mnemonic coaching** → panel 2. It governs interruption, not study method.
- **Rest day** → panel 1. It describes rhythm; reminders should *derive* from it
  rather than own it.

### Naming rule

Explanatory names where the grouping is non-obvious; plain nouns where it is
self-evident. Panels 1 and 2 group things a learner would not predict belong
together, so the label earns its length. Panels 3–5 are obvious, and Buddy-voice
labels there ("My people") would be costume rather than clarity.

## Placement test

Currently one row under "App" that launches the test, with **no retake guard
anywhere** — `router.push('/placement')` is unconditional
(`apps/mobile/app/(tabs)/profile.tsx:633`) and `POST /v1/placement/complete` has
no already-placed check.

**Every attempt is already persisted in full and nothing overwrites it:**
`placement_sessions` holds one row per attempt (indexed `(user_id, started_at)`
— an index that only makes sense if retakes were anticipated), and
`placement_results` one row per kanji per attempt. **No route ever reads it
back**, so the history is write-only today.

This design:

1. **Replaces the launcher with a read-only level display** in panel 1 —
   *"Your level: N4, set 12 June"*. Knowing your level is part of how you learn;
   taking a test is a study action, not app information.
2. **Adds the missing read path** — a `GET` returning the learner's placement
   sessions (`startedAt`, `completedAt`, `inferredLevel`) newest-first — so
   panel 1 can show level over time rather than a single current value. The
   diagnostic data already exists and needs no migration; only the endpoint and
   its consumer are missing. Per-kanji `placement_results` are out of scope for
   this read: the panel needs the level trend, not a question-by-question
   breakdown.
3. **Does NOT add a retake affordance.**

### Why retake is deliberately excluded

**B-210** (logged 2026-07-27): `applyPlacementResults` skips `remembered` /
`burned` rows but **overwrites** `learning` / `reviewing` ones — forcing
`difficulty` to 5, `totalReviews` to 1, and `nextReviewAt` 21 days out. FSRS's
learned estimate of how hard a kanji is *for that learner* is discarded and the
card leaves the queue for three weeks. Silent, immediate, no undo.

The existing guard protects **mastered** cards. The cards it clobbers are the
ones carrying the most FSRS signal. The protection is inverted relative to the
value at risk.

The only thing currently protecting learners is that the retake path is
undiscoverable. **This redesign's entire purpose is making things findable.**
Shipping a more discoverable route to irreversible data loss — with only a
confirmation dialog in between — would make the app worse in precisely the
dimension this work exists to improve.

Retake therefore ships as a follow-on, after the B-210 brainstorm decides what a
retake *should mean* for a learner with existing progress (re-baseline
everything / apply only to unseen kanji / record the new level without touching
the schedule). That is a product decision, not a patch. It also avoids writing
warning copy for behaviour already agreed to be wrong.

## About page correction

`apps/mobile/app/about.tsx` has a section headed **"AI-Generated Mnemonics"**,
badged *Anthropic*, reading: *"Mnemonic hooks and memory stories are generated
using **Claude** by Anthropic. AI-generated content is clearly labelled
throughout the app. You can always edit or replace any hook with your own
words."*

Three inaccuracies, in increasing order of seriousness:

1. **"Generated"** understates what now happens. Auto-generation was retired the
   same day under parent spec §10.2 (`MnemonicNudgeSheet`,
   Generate/Regenerate and Quick/Rich all removed in `c16da2e`). Hooks are now
   **co-created** — the learner supplies the place, the anchor and the personal
   detail; the model assembles them. "Generated using Claude" describes the
   product Phase 5 replaced.
2. **"Replace"** contradicts the product's stated stance. Deepening is
   explicitly additive and the copy discipline forbids "rebuild", "replace" and
   "discard" (parent spec §6.3). The About page tells learners they can do the
   one thing the rest of the app promises never to do to their work.
3. **The attribution is incomplete — and this is an attribution page.** The
   assembly cascade has three tiers: cloud (Claude), **on-device (Apple
   Foundation Models)**, and **template (no model at all)**. Crediting only
   Anthropic under-attributes Apple and misstates the template tier as
   AI-generated. On a licences and acknowledgements screen, under-attribution is
   a worse failure than stale phrasing.

Corrected as part of this change, since panel 5 is being touched anyway. The
correction is a rewrite of that one attribution block; no structural change to
`about.tsx`.

## Scope

**In:** the 11 → 5 regrouping; the two setting moves; dissolution of Privacy /
App / Notifications; read-only level display; placement history read path;
the About correction; a reserved but unbuilt home for BYOK.

**Out:** the B-210 merge fix (separate brainstorm); BYOK implementation; the
Apple Watch reconceptualisation; how-to guides and technical-details content.

Items that do not exist yet are **named in the design but not shipped as empty
rows** — an empty row is worse than an absent one, because it promises
something.

## Open questions

1. **Does an 11-section page becoming a 5-panel page still want a jump index or
   search?** Deferred — five panels may be scannable enough that the question
   dissolves. Worth re-asking after the change is on a device.
2. **Where do how-to guides live when they exist** — inside panel 5, or a
   separate surface? Not decided; panel 5 reserves the concept only.

## Provenance

- Owner requests, 2026-07-27 (Profile ordering; the 11-panel reframe; the
  placement-retake question)
- `ENHANCEMENTS.md` — "Review and reorder the Profile page sections"
- `BUGS.md` — B-210
- Current implementation: `apps/mobile/app/(tabs)/profile.tsx`,
  `apps/mobile/app/about.tsx`, `apps/api/src/services/placement.service.ts`,
  `apps/api/src/routes/placement.ts`
