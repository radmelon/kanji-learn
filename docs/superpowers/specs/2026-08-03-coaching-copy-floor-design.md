# Coaching copy floor — the template layer reads its own evidence

> **Canonical URL — hand this to a new session:**
> https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-08-03-coaching-copy-floor-design.md

Parent spec:
https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-08-01-buddy-coaching-analysis-design.md

Slice 2 (merged PR #11, deployed 2026-08-03) — built the pipeline this fixes:
https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-08-02-coaching-slice2-design.md

Slice 3 (merged PR #12, deployed 2026-08-03) — the second consumer of everything
below:
https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-08-03-coaching-slice3-design.md

---

## 0. Why this exists

Slice 2 shipped and worked. The owner opened the Journal on their own account
and got this:

> *"You have cleared the hardest kanji the test put in front of you. Your
> placement puts you around this level, with some room either side. A handful of
> kanji keep slipping back no matter how often they come around."*

Their verdict: **"Overall Buddy has provided me less than zero value with this
note."** They asked which test and when, what "this level" refers to, which
kanji are slipping, and what they were supposed to do about it.

**The pipeline is correct. The copy is the defect.** `copy.ts`'s `templateCopy`
reads `finding.kind` and nothing else — it looks up a static string per kind and
returns it. **`finding.evidence` is never touched.**

That inverts the parent spec's §1, which says `Evidence.label` is display-safe
text computed in the analyzer *"so the voice layer has nothing left to calculate
— that is the load-bearing invariant of §1."* The whole point of precomputing it
was for the copy layer to use it.

Every one of the owner's questions had an answer sitting unused in the finding:
`level_estimate` carries `most likely level: N4` while its copy says *"this
level"*; `leech` carries the worst kanji **named, with lapse counts**, while its
copy says *"a handful"*.

**What the review process missed.** Fifteen fix cycles went into whether the
plumbing was correct — write ordering, coalescing keys, finding memory — and not
one asked whether the output was *useful*.

---

## 1. Scope

**In:** `packages/shared/src/coaching/` — `copy.ts` and the seven detector
files, plus the two contract changes §5 requires.

**Out:** no migration, no API change, no mobile change, **no EAS build.** This
deploys straight to the notebook the owner is already reading, and to slice 3's
template fallback, on the next API rollout.

---

## 2. The two consumers — this is no longer a one-reader change

Slice 3 landed between the audit below and this spec, and it added a second
reader of the same data. Both matter:

| Consumer | Reads | Effect of this spec |
|---|---|---|
| `analysisBody(findings, now)` → `templateCopy` | `finding.kind` only, today | Becomes the per-kind formatters. Writes the notebook entry **and** slice 3's template fallback. |
| `buildCoachingPrompt`'s `describe()` (slice 3) | `${e.label}: ${e.value}` for every evidence item | Sees any label rename immediately, and gains every new evidence field §5 adds — for free. |

Two consequences the original design could not have known:

1. **Renaming an `Evidence.label` now changes the LLM prompt as well as the
   template.** §4's exported constants are therefore load-bearing for two
   readers, not one.
2. **Every evidence field added in §5 improves the LLM path at no extra cost**,
   because `describe()` serialises the whole array generically. `completedAt`,
   `strokeCount` and the rest reach the model the moment the detector emits them.

`templateCopy` has exactly two call sites outside its own module —
`analysisBody` (`copy.ts:84`) and slice 3's mechanics append
(`coaching-voice.service.ts:216`). That is the entire blast radius.

---

## 3. The audit — all ten kinds

The question asked of each: *what would a learner ask next, and can the evidence
answer it?*

| Kind | Class | Learner's next question | Answerable today? |
|---|---|---|---|
| `reading_lag` | Direct | By how much? Kun or on? What do I do? | Gap ✅ · **kun/on ❌ (deferred, §9)** · action ❌ |
| `leech` | Direct | Which kanji? How often? What do I do? | Named kanji ✅ · action ❌ |
| `commitment_gap` | Direct | By how much? Which period? Now what? | Minutes ✅ · **dates ❌** · action ❌ |
| `hook_coverage` | Direct | Which kanji? | ✅ **in evidence, unused by copy** |
| `level_estimate` | Orient | What level? What range? When? | Level+range ✅ · **date ❌** |
| `mechanics_explainer` | Orient | Where is the fuller explanation? | 🔴 **points at a page that does not exist** |
| `fluency_gain` | Motivate | How much faster? Over what period? | Speed ✅ · **window ❌** |
| `theta_delta` | Motivate | By how much? Between when? | ✅ **fully equipped, all unused** |
| `hardest_cleared` | Motivate | Which one? Hard how? When? | Kanji ✅ · **basis ❌** · **date ❌** |
| `retest_due` | Motivate | How long? What is "uncertainty"? Where? | Days ✅ · jargon ❌ · location ❌ |

---

## 4. The three changes

### 4.1 `templateCopy` becomes per-kind formatters

`Record<FindingKind, (f: Finding, now?: string) => string>` replaces the static
`BASE` record. Each formatter reads its own finding's `Evidence`.

The existing hedging (`confidence < 0.4`) and escalation (`since` older than 21
days) wrappers stay exactly as they are, applied around the formatter's output —
they are orthogonal to which sentence gets built, and `mechanics_explainer`
keeps its exemption from both.

### 4.2 Evidence labels become exported constants

Shared between the detector that writes them and the formatter that reads them.

Without this, formatters match label strings and a rename silently yields
`undefined` in a learner-facing sentence — **the exact failure mode that
produced the note in §0.** With slice 3 in place it would also silently change
what the LLM is told (§2).

Constants live beside the `Evidence` contract in `types.ts`, not in `copy.ts`,
so a detector can import them without importing the copy layer.

### 4.3 Detectors emit what the audit found missing

See §5 for which of these are passthroughs and which are contract changes.

---

## 5. Not all of §4.3 is a passthrough — and the plan must not pretend otherwise

The original design listed these together. They are not the same size of job.
**Verified against the code on 2026-08-03:**

| Field | Kind | Source | Cost |
|---|---|---|---|
| `completedAt` | `level_estimate`, `hardest_cleared` | `PlacementSnapshot.completedAt` — already on the contract | **Passthrough.** Detector edit only. |
| `periodStart` / `periodEnd` | `commitment_gap` | `CommitmentSnapshot.periodStart` / `.periodEnd` — already on the contract | **Passthrough.** Detector edit only. |
| `strokeCount`, `readingCount` | `hardest_cleared` | ❌ **not on `PlacementItemOutcome`** | **Contract + assembly change.** |
| window length | `fluency_gain` | ❌ **not on `ReviewSnapshot`** | **Contract + assembly change.** |

### 5.1 `strokeCount` / `readingCount`

`PlacementItemOutcome` carries `kanjiId, character, meaningCorrect,
readingCorrect, readingOffset, difficultyAtAsk` and nothing else. Both new
fields must be added to it, and `CoachingService.placementItems()` must supply
them.

The source columns exist: `kanji.strokeCount` (`smallint`, not null) and
`kanji.kunReadings` / `kanji.onReadings` (`jsonb` string arrays, not null,
default `[]`). `placementItems()` already `innerJoin`s `kanji`, so this is
extending an existing select, not adding a join.

**`readingCount` is `kunReadings.length + onReadings.length`, computed in
assembly, not in the detector.** The analyzer must stay pure and must not learn
the shape of a jsonb column.

### 5.2 `fluency_gain`'s window

`REVIEW_WINDOW_DAYS = 30` lives in `coaching.service.ts` — the assembly layer
that owns it. The detector is pure and cannot see it, so the snapshot must carry
it: add `windowDays: number` to `ReviewSnapshot`, populated from that constant.

**Do not inline "30 days" or "the last month" in the formatter.** The constant
is documented as an assembly parameter; a copy string that hardcodes it becomes
a lie the first time it changes, and nothing would fail.

---

## 6. The copy, per kind

Every sentence below is the **full-evidence** form. §7 governs what happens when
the evidence is absent.

Actions are **verbal, not interactive.** The notebook renders plain text and
`NotebookBody` has no action affordance. Naming the specific kanji and the
specific move is most of the value; a tappable button would need a client
contract change, mobile work and a build. Verified reachable: co-creation opens
from `apps/mobile/app/kanji/[id].tsx` and `study.tsx`, so "look it up and build
a hook" is a real instruction, and Profile → Placement Test
(`apps/mobile/app/(tabs)/profile.tsx:729`) is a real retake route.

**Write in full sentences, and never leave a comparative or a pronoun without
its referent.** "It will tighten as you do more" was in an earlier draft of this
section and is exactly the defect §0 is about: more *what* — more study, more
quizzes, another placement test? A sentence a learner has to interpret is a
sentence that failed. If a claim cannot be made specific from the evidence
available, do not make it.

### Direct

> **`leech`, more troubled than can be named** — 23 kanji are giving you
> trouble, and three of them are 敗, which has lapsed 4 times, 語 3 times, and
> 使 twice. The one to work on first is 敗. Look it up and build a hook for it —
> a small story or image that ties the character to something you already know —
> because that is what usually stops a kanji from slipping.

> **`leech`, every troubled kanji named** — Three kanji are giving you trouble —
> 敗 has lapsed 4 times, 語 3 times, and 使 twice. The one to work on first is
> 敗. Look it up and build a hook for it — a small story or image that ties the
> character to something you already know — because that is what usually stops a
> kanji from slipping.

> **`leech`, a single troubled kanji** — One kanji is giving you trouble — 敗,
> which has lapsed 4 times. Look it up and build a hook for it — a small story
> or image that ties the character to something you already know — because that
> is what usually stops a kanji from slipping.

**⚠️ This wording replaced an earlier owner-approved sentence, and the reason is
worth keeping.** The original read *"Three kanji keep slipping back no matter
how often they come round"*. Two things were wrong with it, both found by
checking the rendered copy against live data rather than against tests:

1. **The count was the display cap, not the learner's problem.** `MAX_NAMED = 3`
   caps how many kanji are *named*; the true count is emitted separately as
   `kanji giving trouble` and the formatter never read it. On live, one account
   has **23** troubled kanji and would have been told "Three" — understating by
   a factor of eight. That is §0's defect exactly, reproduced inside the finding
   this spec exists to fix, and the old vague `BASE` string was at least not
   false.
2. **"no matter how often they come round" overstates the trigger.**
   `MIN_TROUBLE_SCORE = 1`, so a *single* lapse qualifies a kanji — and 19 of
   those 23 cards have exactly one. The sentence asserted repetition and then
   printed evidence of one lapse directly after it.

**The owner reviewed the replacement on 2026-08-03 and accepted it**, including
the loss of the word-picture of a card cycling back through review. That was
atmosphere; the persistence claim now lives in the lapse counts, where it is
evidence-backed. They also directed that **`BASE.leech` be rewritten to match** —
otherwise the removed claim survives in the fallback, which is the one string
nobody reads until everything else has failed.

Note the single-kanji branch drops "The one to work on first is …": prioritising
among one thing is absurd.

> **`hook_coverage`** — 敗 keeps catching you out. When something new will not
> stick, it usually helps to connect it to something you already know well: that
> connection is what we call a hook. It can be a small story, an image, or a
> resemblance to a word or a thing you are already familiar with, and it works
> because memory holds on to the familiar far more readily than the unfamiliar.
> Would you like to build one for 敗 together?

> **`commitment_gap`** — You promised 60 minutes between 20 and 26 July and
> studied 20. It is worth discussing whether we should try shifting the time of
> day when you study, or try two short study sessions in a day. Or maybe it was
> just a busy week.

> **`reading_lag`** — Your readings are trailing your meanings, 62% against 88%
> across 24 answers, which is a wider gap than most people have. Next time you
> study, try saying the reading aloud before you reveal the answer.

### Orient

> **`level_estimate`, spread interval** — Your placement test on 29 July puts
> you at N4, and the honest range runs from N5 to N3. That range is wide because
> a placement test only asks about a dozen questions. It narrows when you take
> the placement test again, rather than from day-to-day studying, because your
> level estimate is only recalculated when you sit the test.

> **`level_estimate`, interval inside one band** — Your placement test on 29
> July puts you at N5. The honest range around that estimate stays entirely
> within N5, rather than reaching into a neighbouring level. Your level estimate
> is only recalculated when you take the placement test again, rather than from
> day-to-day studying.

> **`mechanics_explainer`** — Your level comes from a statistical technique
> called Item Response Theory, or IRT. The test gets harder when you answer well
> and easier when you do not, which is how it can say something useful about
> your level in about a dozen questions.

**Why `level_estimate` has two branches, and why the second says nothing about
confidence.** Found during implementation, and it is the sharper half of this
finding:

- With one branch, a learner whose credible interval fits inside a single JLPT
  band reads *"the honest range runs from N5 to N5. That range is wide."* The
  sentence contradicts itself, and it is reachable at the codebase's own
  definition of a tight estimate — `SE_TIGHT = 0.3` gives an interval of 0.77
  logits, narrower than any band.
- The obvious repair — "narrow enough to sit entirely within N5, so the test is
  reasonably confident" — is **also wrong**, because `low === high` signals band
  *collapse*, not precision. The outer bands are unbounded, so at θ = −3.0,
  se = 0.55 the interval spans 1.41 logits — wider than the whole N4 band — and
  still collapses to N5. Worse, above se ≈ 0.84 the finding's confidence drops
  under `HEDGE_BELOW`, so `templateCopy` prepends *"Early signal, so take it
  lightly:"* to a sentence claiming the test is confident. The paragraph argues
  with itself.
- **So the collapsed branch states only what is true by construction — that the
  range stays inside one level — and leaves every confidence claim to the
  hedge**, which is the one mechanism that actually reads the standard error.
- It interpolates the **lower bound**, not the stored `level`. Those come from
  different moments: `level` is `placementSessions.inferredLevel` from test
  time, while the bounds are recomputed at coaching time against today's
  corpus. A recalibration between them makes the containment claim false;
  interpolating the bound makes it true by construction. `coaching.service.ts`
  already carries a scar comment about exactly this class of mismatch (B146).

### Motivate

> **`fluency_gain`** — You are answering about 22% faster than you were a month
> ago, across 41 kanji, and your accuracy has not slipped while doing it. Speed
> usually improves before anything else does, so this is a sign that recalling
> these characters is becoming automatic rather than effortful.

> **`theta_delta`** — Your ability estimate has risen from 0.31 to 0.68 between
> your placement tests on 12 July and 29 July. That rise is larger than the
> uncertainty in both measurements combined, so it is real progress rather than
> the test landing differently on the day.

> **`hardest_cleared`** — You cleared 願, which was the hardest item the test
> put in front of you: it has 19 strokes and three readings. The test weighs
> stroke count and number of readings alongside JLPT level, which is why 願
> counted as harder than some N2 kanji you also saw.

> **`retest_due`** — You took your placement test 34 days ago, and the estimate
> of your level has drifted since then because it has had no new information.
> You can take the test again from your Profile, and doing so would narrow the
> range around your level rather than simply repeating what you already know.

### 6.1 What a "hook" is, and where the explanation lives

Two findings tell a learner to build a hook, and the word means nothing on its
own. A hook is **a deliberate connection between an unfamiliar kanji and
something the learner already knows well** — a story, an image, or a
resemblance. The explanation matters more than the instruction: a learner told
to "build a hook" without knowing what one is cannot act, and the whole point of
this spec is copy that can be acted on.

`hook_coverage` carries the full explanation, because making the offer is its
entire purpose. `leech` carries a one-clause version, because its subject is the
slipping kanji rather than the technique.

⚠️ **Both can appear in the same note.** They are both Direct findings and
`select()` takes the top three, so a learner can be told what a hook is twice in
one entry. Formatters are per-finding and pure — a formatter cannot see what
else was selected.

**Decision: accept the redundancy rather than build a cross-finding mechanism.**
The short form in `leech` reads as emphasis rather than repetition, and the
alternative — passing selection context into `analysisBody` so formatters can
suppress each other — couples the copy layer to the selection layer to save one
clause. Revisit only if a real note reads badly.

The plan must include a test that renders `leech` and `hook_coverage` together
and asserts the result is not absurd, so this decision is at least observed
rather than assumed.

---

## 7. Degradation rule

**A formatter that cannot find its evidence returns the base sentence.** Never
`undefined`, never a half-built one.

The base sentences are today's `BASE` strings, retained for exactly this
purpose. They are vague, which is the whole complaint — but a vague true
sentence beats `"You cleared undefined — the hardest item"`.

`reading_lag` matters most: **its evidence differs depending on whether it fired
from placement or from quiz.** The placement branch emits `meaning accuracy`,
`reading accuracy`, `expected reading penalty`, `items with a reading asked`;
the quiz branch emits `quiz reading accuracy`, `quiz meaning accuracy`, `quiz
reading answers`. A formatter that only knows one shape silently degrades half
the time, and the degradation is invisible because it returns a real sentence.

---

## 8. `mechanics_explainer` points at a page that does not exist

Its template says *"There is a fuller explanation in your Profile."*
**Re-verified 2026-08-03: there is no IRT section in Profile.** Profile has a
Placement Test row that opens the retake (`profile.tsx:729`) and nothing
explaining ability estimation. The parent spec's §7 schedules that page as
slice 5.

That string is live in production sending learners to a dead end, on the one
finding whose entire purpose is building trust.

**Decision: remove the pointer sentence now; slice 5 restores it when the page
exists.** Keep the two-sentence IRT explanation, which stands alone.

This also flows through slice 3 for free: `coaching-voice.service.ts:216`
appends `templateCopy(mechanics, now)` verbatim, so the fix reaches the LLM
surface with no change there.

---

## 9. "Hardest" needed explaining, and the answer changes the copy

The owner asked what `hardest_cleared` means by hard — strokes? JLPT? rarity?

`b` (item difficulty) is a weighted sum of five z-scored features
(`placement-difficulty.ts:112`): JLPT rank, log frequency rank, school grade,
stroke count, and reading count. That prior is then blended with observed
learner performance from `review_logs`.

**Two things worth knowing.** First, the blend is currently **inert** —
`observed_n = 0` for these kanji, so `b = b_prior` exactly. "Hardest" today
means hardest *by feature model*, not by how learners actually perform. Second,
their hardest-cleared was **願 (N3, 19 strokes, 3 readings, b=1.01)**, which
outranked **刊 (N2, 5 strokes, b=0.95)** and **筆 (N2, 12 strokes, b=0.94)**.

**So a bare superlative invites a JLPT lookup that makes it look wrong.** §6's
sentence carries its own justification, which is why §5.1 is worth its cost.

---

## 10. Testing

**Every formatter tested twice** — once with full evidence, once with evidence
stripped, to prove the degradation path in §7. `reading_lag` is tested **three**
times: placement-shaped evidence, quiz-shaped evidence, and stripped.

**Each test names the mutation it catches.** This is not a style rule. Slice 3's
execution found three tests in its own plan that could not fail — an assertion
that passed under the very mutation its comment named, a comment naming a
structurally uncatchable mutation, and a duplicate route test claiming to prove
a guard it never exercised. All three were written by the plan's author and
caught only because a reviewer checked the claim rather than the code.

**So the naming itself must be verified.** A plan for this work must state, for
each test, the mutation *and* the reviewer must confirm that mutation actually
turns it red.

One property deserves a dedicated test: **no formatter output contains the
string `undefined`**, over a matrix of every kind × full/stripped evidence. That
is the defect class §4.2 exists to prevent, and it is cheap to pin globally.

Lane: shared only. `pnpm --filter @kanji-learn/shared test`. No database, no
API, sub-second.

---

## 11. Out of scope

- **`reading_lag`'s kun-vs-on split.** Does not exist anywhere in
  `LearnerSnapshot` — `CardSnapshot` has `readingStage` but no per-reading-type
  accuracy. That is a detector *and* assembly change of its own. Say "readings"
  without the split.
- **Finding ORDER.** The owner got praise, then orientation, then the actual
  problem. That is the parent §4 working as designed — the primary sort is
  `magnitude × confidence × novelty`, and §3's Direct/Orient/Motivate priority
  only breaks ties, so a strong Motivate finding outranks a weak Direct one.
  Their reaction suggests that may be wrong, but changing it is a §4 decision
  with a wider blast radius than copy, and it would move what the LLM is handed
  as well as what the notebook says.
- **The Profile IRT page.** Slice 5, per the parent §7. §8 removes the pointer
  rather than building the destination.
- **Anything in the LLM path.** Slice 3 owns it. This spec improves what it is
  handed and what it falls back to, and touches none of its code.
- **The Journal's presentation layer** — see §11.1, which is a real gap rather
  than a deferral.

### 11.1 The Journal's presentation layer is out of scope here, and nothing else owns it

Asked directly, and the answer is worth recording because it is not the answer
one would assume.

**Yes, presentation is out of scope for this slice.** This slice changes only
the strings `analysisBody` produces; it does not touch how the Journal lays them
out, orders them, or distinguishes a current entry from a superseded one.

**And no, there is no slice dedicated to Journal UI/UX.** Verified 2026-08-03
against both roadmaps:

- The parent coaching spec's §12 lists six slices — analyzer, notebook surface,
  conversational surface, companion mode, IRT explainer + Profile, goal beat.
  **None is a presentation slice.**
- The Journal itself was built by
  https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-07-31-buddy-home-notebook-design.md
  Its §15 out-of-scope list defers voice conversation, the Japanese-localised
  tutor report, Phase 4 social, and Progress refinements — **no Journal
  presentation work is listed as deferred**, because that spec considered the
  surface finished when it shipped.

So the presentation layer is not deferred; it is simply unowned. The nearest
queued item is that spec's §14.1 — *how many observations stay live before
ageing into the archive* — which it explicitly calls "a number to tune against
real sessions, not to guess once", and which is a presentation decision wearing
a data-retention costume.

**This spec does not create that slice**, for a reason worth stating: the
owner's complaint in §0 was entirely about *content* — which test, which kanji,
what to do — and not one part of it was about layout, spacing or hierarchy.
Fixing the copy is the correct response to the evidence in hand. Inventing a
presentation slice now would be guessing at a second problem before the first is
fixed.

**But it should be decided rather than forgotten.** The honest test is to read
the Journal again once this slice ships. If the entries are now useful but hard
to read — too dense, unclear which is current, no sense of trajectory across the
superseded chain — that is a real slice and should be specced from what the
owner actually finds wrong with it, not from a guess made today.

---

## 12. Corrections to the design this spec transcribes

The design was settled in the 2026-08-03 handoff and this spec follows it. Two
things in it did not survive contact with the code, and are corrected above
rather than silently:

1. **`leech` names at most THREE kanji, not four.** `MAX_NAMED = 3`
   (`leech.ts:34`). The handoff's worked example named four (*"敗 has lapsed 4
   times, 語 3, 使 and 去 twice each"*). §6 uses three. A plan that copied the
   four-kanji example would produce a formatter whose fixture cannot occur, and
   a test asserting output the detector can never emit.

   Raising `MAX_NAMED` to 4 is a defensible alternative but it is a **detector**
   decision about how many kanji a learner can act on at once, not a copy
   decision, and nothing in the complaint asks for it. Left at 3.

2. **`strokeCount`/`readingCount` and `fluency_gain`'s window are contract
   changes, not passthroughs.** The design listed all of §4.3 as one bullet.
   §5 separates them, because two of the four require editing
   `LearnerSnapshot`'s contract and `CoachingService`'s assembly — which means
   the API package's tests are in scope for those two, and the "shared lane
   only, sub-second" framing in §1 holds for the copy work but not for them.

---

## 13. Owner review — 2026-08-03

Feedback on §6, incorporated above rather than appended. Recorded because the
reasoning outlives the edit.

1. **"We should provide more explanation on what a hook is."** A learner told to
   build one, who does not know what one is, cannot act — which would have
   reproduced §0's defect in a new place. §6.1 now carries the definition, and
   the explanation is framed the way the owner put it: *connecting something
   new, like an unfamiliar kanji, with something you already know and are
   familiar with.*

2. **`commitment_gap`'s action was wrong in kind, not just vague.** The draft
   said *"bring it to your next session and we will set something you will
   actually hit"* — which quietly assumes the learner over-promised and should
   promise less. The owner's replacement offers **mechanism** instead
   (shift the time of day, or split into two short sessions) and, importantly,
   ends by allowing that nothing is wrong at all: *"Or maybe it was just a busy
   week."* A coach that treats one missed week as a character flaw is worse than
   silent.

3. **"It will tighten as you do more." More what?** The draft failed its own
   §0 test. The corrected sentence names the mechanism, and the mechanism turned
   out to be non-obvious enough to be worth verifying: `abilityTheta` and
   `abilitySe` are written **only** by `placement.service.ts:319`, on completing
   a placement test. Ordinary studying and quizzes never move them. So "as you
   do more" was not merely vague — read as "more studying", it would have been
   **false**.

**The general rule this establishes, applied to all ten kinds:** write full
sentences, and never leave a comparative, a pronoun, or a piece of jargon
without its referent. Three further sentences were rewritten under it —
`reading_lag` said "before you flip" (card jargon), `fluency_gain` said "the
shape of something becoming automatic" (evocative, unfalsifiable), and
`retest_due` said "the test is worth more the second time" (true, but it does
not say why or narrow what).
