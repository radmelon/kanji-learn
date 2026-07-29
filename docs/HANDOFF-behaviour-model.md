# Session handoff — the learner behaviour model

**Canonical URL — hand this to a new session:**
https://github.com/radmelon/kanji-learn/blob/main/docs/HANDOFF-behaviour-model.md

Written 2026-07-29. **Third in the queue**, after the build-and-test protocol
([`HANDOFF.md`](HANDOFF.md)) and the placement model
([`HANDOFF-placement-and-b210.md`](HANDOFF-placement-and-b210.md)).

Referenced from
[`2026-07-28-new-learner-arc-design.md`](superpowers/specs/2026-07-28-new-learner-arc-design.md)
§12. That spec ships a deliberately narrow version; this session designs the
real thing.

---

## Why this exists

A single metric — burstiness — turned out to reach into projection confidence,
review-debt forecasting, rescue triggers, invitation selection and the tutor
report. When one number wants to touch five systems, the subject is bigger than
the number.

Owner, 2026-07-29:

> *"I am particularly interested in understanding how B feeds into the FSRS
> model. But also how we can design a model that is specifically tracking each
> student's study behavior in order to drive Buddy's encouragement and coaching
> activities. Also when present we might have a human tutor who is consuming a
> report we generate on demand. We need to consider adding these details to that
> report."*

## What is already established

**Burstiness** (Goh & Barabási): `B = (σ − μ) / (σ + μ)` over gaps between study
days. −1 perfectly regular, 0 Poisson, +1 highly bursty.

**Measured on live accounts, 2026-07-29:**

| | study days | mean gap | max gap | B |
|---|---|---|---|---|
| RAD | 10 | 4.0d | 8d | **−0.200** |
| Buddy | 71 | 1.8d | 22d | **+0.235** |
| Bucky | 18 | 6.2d | 61d | **+0.381** |

RAD has the fewest study days and the best rhythm; the owner has seven times the
volume and a worse one. **Volume and regularity are orthogonal and both matter** —
that is the finding the whole model should be built around.

**Two traps already identified** (arc spec §5C3): declared `rest_day` must be
excluded from the interval series or the app penalises its own feature; and the
formula is biased at small n, so use the **Kim & Jo (2016)** correction and
return `null` below a floor.

## The FSRS question — start from this position

**B must not feed into FSRS.** Injecting a behavioural metric into stability,
difficulty or retrievability decalibrates a published model, and the project has
just committed to being accurate about the open-source methods it uses. FSRS
answers *when should this card be reviewed for retention*; burstiness answers
*when will this learner be here*. Conflating them corrupts the one that works.

The value is at the intersection. Two uses look defensible and one does not yet:

- ✅ **Review-debt forecasting.** FSRS due-dates × predicted attendance =
  predicted backlog. Cards accrue silently during a gap; the learner returns to a
  wall. Makes the wall predictable and therefore preventable.
- ✅ **Load balancing within FSRS's existing tolerance.** FSRS accepts interval
  jitter without meaningful retention loss, and mainstream implementations use it
  to smooth daily counts. Biasing that jitter toward days the learner actually
  attends spends slack the model already grants.
- ⚠️ **Per-learner desired-retention tuning.** A bursty learner might warrant
  higher desired retention so a long gap does less damage. Plausible, unproven,
  and it changes real learning outcomes. **This is the session's hardest
  question. Do not ship it on intuition.**

## Scope

**1. A model wider than one metric.** Candidates, all computable from existing
data:

| Signal | Source | Answers |
|---|---|---|
| Burstiness | `daily_stats` | regular or bursty? |
| Active ratio | `daily_stats` | how much? |
| **Memory coefficient** (same paper) | `daily_stats` | do short gaps follow short gaps — *declining* or *random*? |
| Time-of-day preference | `review_logs` | when to invite |
| Session length distribution | `review_sessions` | short-and-often or long-and-rare? |
| Modality balance | `modalityCounts` | flashcard-only drift |
| Grade/level drift | `user_kanji_progress` | working above or below level |

The memory coefficient matters most: burstiness alone cannot distinguish a
learner *steadily disengaging* from one who is simply irregular. Those need
opposite responses.

**2. What actually drives coaching.** For each signal: which intervention does it
justify, and what happens when it fires? **A model that measures more than it
acts on is surveillance, not teaching.** Signals with no intervention attached
should be cut, however interesting.

**3. The tutor report as a designed instrument.** `ReportData` has accreted into
nine sections. `effort` already carries `dailyStats30` / `dailyStats90` — so
burstiness needs **no new query** — and `weekendVsWeekdayRatio` is a crude
regularity proxy this supersedes.

The arc spec (§5C3) proposes:

```ts
consistency: {
  burstiness: number | null
  activeRatio30: number
  activeRatio90: number
  trend: 'steadying' | 'stable' | 'fragmenting' | 'insufficient_data'
  restDaysExcluded: boolean
}
```

**Written for a human, not a dashboard.** A tutor reading `B = +0.235` learns
nothing; *"studies in concentrated bursts with gaps up to 22 days; rhythm has
been fragmenting over the last month"* is a teaching observation. Carry both.

**4. Privacy and framing.** Behavioural tracking of a learner is exactly the kind
of thing that should be explicit rather than discovered. The parent spec §13
covers privacy; check this against it. **Never comparative** — §10 forbids
leading with a negative comparison, and these metrics would make a toxic
leaderboard.

## Questions to settle

1. Where does the model live — computed on read, or materialised? `learner_state`
   exists as a concept from Phase 0.
2. What is the minimum history before any signal is emitted at all?
3. Does the learner get to *see* their own behaviour model? Arguments both ways:
   self-knowledge is motivating; being measured is not.
4. Does a tutor's copy differ from the learner's? The report is already a
   professional instrument, so a tutor can probably see rawer numbers.
5. Does per-learner desired-retention tuning have enough evidence to try, and if
   attempted, how would it be evaluated without harming the learner?

## Files

| | |
|---|---|
| Milestone ladders + focus inference | `packages/shared/src/milestones/` |
| Daily study data | `daily_stats` (has `date`, `reviewed`, `correct`, `studyTimeMs`) |
| Tutor report | `apps/api/src/services/tutor-report.service.ts` |
| Tutor analysis | `apps/api/src/services/tutor-analysis.service.ts` |
| FSRS engine | `packages/shared/src/fsrs/` |
| Rest day | `user_profiles.rest_day` |

## Warning

The live dataset is **five accounts**, three with meaningful history. Any model
fitted or tuned against it is fitted to the owner and two testers. Design the
model; be very cautious about calibrating it. Anything that adapts scheduling
per learner needs far more data than exists today.
