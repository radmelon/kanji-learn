# Kanji Buddy v2 — Phase 1+ Refresh

**Date:** 2026-05-23
**Status:** Approved design (brainstorm complete) — ready for Phase 0a / 1' implementation planning.
**Author:** R. Dennis (with Claude)

**Companion documents:**
- Design (canonical vision): [`2026-04-09-kanji-buddy-design.md`](2026-04-09-kanji-buddy-design.md) — 17-section vision (unchanged by this refresh).
- Spec (canonical technical): [`2026-04-09-kanji-buddy-spec.md`](2026-04-09-kanji-buddy-spec.md) — technical reference (largely unchanged; see §5 for the one substantive update).
- Phase 0 plan (historical): [`../plans/2026-04-10-kanji-buddy-phase-0-foundation.md`](../plans/2026-04-10-kanji-buddy-phase-0-foundation.md) — partially executed; completed by Phase 0a in §3 below.

---

## §1 — Purpose of this document

This is a **refresh**, not a replacement. The April 2026 design + spec for Kanji Buddy stand. What's changed in the six weeks since approval is the **state of the codebase around the spec** — three sibling specs shipped (Practice Loop, FSRS migration, Tutor Analytics), and Phase 0's foundation work landed unevenly: code shipped, database schema never migrated.

The refresh has three jobs:

1. Record what shipped between April 9 and May 23, 2026 that the April design didn't anticipate, and how those shipments interact with the Buddy roadmap.
2. Update the Phase 0–10 plan in §14 of the April design — phase scope, ordering, and acceptance criteria — to reflect current reality.
3. Capture two design refinements that emerged in conversation since April: the mascot/monkey framing and the FSRS-based leech-detection re-anchor.

This document does **not**:

- Modify the April design's vision (§1), pedagogical foundation (§3), or character definition (§4).
- Re-architect the LLM router, the three-tier cost model, or the UKG/MCP portability layer (§11–12 of the April design).
- Specify any individual phase in detail. Phase-level specs come from phase-level brainstorms.

---

## §2 — What's changed since April 9, 2026

### 2.1 — Spec 1 (Practice Loop) shipped in May

Spec 1 — the "Three-Modality Practice Loop" — landed in TestFlight build B134 and is in `main`. It implements a time-boxed minutes-budget session that links Study, Writing, and Speaking practice with a quiz check at the end. This covers **stages 1, 3, and 4 of the April design's 5-stage Learning Loop** (§5 of the April design: Introduce → Anchor → Reinforce → Assess → Adapt). Stage 2 (Anchor = mnemonic) and Stage 5 (Adapt = Buddy) are not in Spec 1 — those are Phase 5 and Phase 3 territory respectively.

**The Practice Loop ships the loop without Buddy in the driver's seat.** Routing decisions are rule-based: a `maybeSlipping` heuristic gates the quiz leg, deterministic rules pick writing/speaking legs.

**Implication for the Buddy roadmap:** Phase 3 ("Study Orchestration Engine — the linking") is partly shipped — the loop exists. What remains is putting Buddy in the seat: replacing or augmenting rule-based routing with Buddy-mediated routing, and adding the leech-detection + confused-pair-drill behaviors the April spec described. This significantly reduces Phase 3's effort and increases its leverage (the surface to act on is already there).

### 2.2 — Spec 1.5 (FSRS migration) shipped in May

Spec 1.5 replaced the SM-2 scheduler with FSRS-5. Every `user_kanji_progress` row now exposes `stability`, `difficulty`, `lapses`, and `total_reviews`; [`packages/shared/src/srs.ts`](../../../packages/shared/src/srs.ts) exposes `retrievability(card, atTime)` returning the probability the learner can recall a card *right now*.

The April spec's leech detection in [`services/buddy/constants.ts`](../../../apps/api/src/services/buddy/constants.ts) uses `lapseCount >= 3` to flag a leech. That worked under SM-2 (where Hard/Again triggered an interval reset to 1 day, making lapses the canonical struggle signal). Under FSRS, lapses still happen, but **the finer-grained signal is R(t)** — a card whose retrievability has dropped below ~0.6 is *literally fading from memory*, regardless of how many discrete lapses it's logged.

**Implication:** Phase 3's leech-detection logic re-anchors on FSRS R(t) — see §5 below for the refreshed predicate.

### 2.3 — Tutor Analytics validated the LLM router in production

The April plan's LLM router is **live in production** — [`TutorAnalysisService`](../../../apps/api/src/services/tutor-analysis.service.ts) consumes it daily to generate Claude-tier (3) diagnoses for human tutors viewing a student's report. The router has been observed running for ~6 weeks; rate limiting, telemetry, and provider fail-over all work.

**Implication for §11 (cost architecture) of the April design:** the architectural choice is validated by an in-production workload. No reason to revisit the tiered model. A practical follow-on is that the Phase 1 "no LLM calls" risk-reduction posture from the April plan can relax (see §4.2 Phase 1').

### 2.4 — Phase 0 partial-ship

Phase 0 was meant to land the architectural skeleton with no user-visible changes. The plan landed unevenly:

| Component | Status |
|---|---|
| LLM router (Groq / Gemini / Claude / Apple-stub) | ✅ Shipped, live |
| [`buddy-types.ts`](../../../packages/shared/src/buddy-types.ts), [`llm-types.ts`](../../../packages/shared/src/llm-types.ts) | ✅ Shipped, re-exported; no non-LLM consumers yet |
| [`services/buddy/learner-state.service.ts`](../../../apps/api/src/services/buddy/learner-state.service.ts) | ⚠️ Implemented, **orphaned** (never invoked) |
| [`services/buddy/dual-write.service.ts`](../../../apps/api/src/services/buddy/dual-write.service.ts) | ⚠️ Implemented + wired into `SrsService.submitReview()` |
| [`services/buddy/constants.ts`](../../../apps/api/src/services/buddy/constants.ts) | ✅ Shipped |
| 17 Buddy / UKG tables defined in [`schema.ts`](../../../packages/db/src/schema.ts) | ❌ **Defined in source; never migrated to any database.** No `0008_buddy_phase0.sql`. Most recent migration is `0024_fsrs_migration.sql`. |
| Mobile UI (BuddyCard, nudge surfaces) | ❌ Not started |
| `/v1/buddy/*` routes | ❌ None |

The unmigrated schema is the most consequential gap. `DualWriteService.recordReviewSubmissions()` runs on every review submission and calls `db.insert()` against tables that don't exist in the live database. Either it's silently no-op'd (try/catch around the dual-write) or it's been failing for six weeks in a way that hasn't surfaced. **Phase 0a (§3) repairs this before any further Buddy work touches the DB.**

---

## §3 — Phase 0a: Cleanup (the unavoidable first slice)

Phase 0a is not a new phase from the April roadmap — it is the **completion of Phase 0**. Its scope is bounded by what's missing, not by new capability.

### 3.1 — In scope

1. **Generate a Drizzle migration for the 17 Buddy/UKG tables** defined in `schema.ts`. Filename follows the established numbering: `0025_buddy_phase0.sql` (FSRS was `0024`). Apply to the live DB following the clone-rehearsal pattern established by the FSRS rollout ([`../runbooks/2026-05-22-fsrs-rollout.md`](../runbooks/2026-05-22-fsrs-rollout.md)).
2. **Verify what `DualWriteService.recordReviewSubmissions()` is actually doing in production today.** Confirm whether dual-write calls have been failing silently for six weeks, succeeding, or no-op'd by try/catch. The result determines whether backfill is needed (see 3.2).
3. **Wire `LearnerStateService` into a refresh hook.** Recommended seam: refresh on every successful review submission, *after* the dual-write commits, in a `setImmediate`/non-blocking call. Frequency cap (e.g. no more than once every N seconds per user) to avoid thrash on heavy sessions. Persist to `learner_state_cache`.
4. **Add basic observability.** A daily count of `learner_state_cache` rows refreshed, a count of `buddy_llm_telemetry` rows written, a count of dual-write commits. Surface these as an internal-dashboard or logged metric — not user-facing.

### 3.2 — Out of scope

- Any user-visible change. Phase 0's original "no user-visible changes" constraint stands.
- Any Buddy *behavior* — no nudges, no plans, no routing changes. Phase 0a is plumbing-only.
- Backfilling six weeks of missing dual-write data — *unless* the verification in (3.1.2) shows the dual-write has been actively failing AND a downstream Phase 1+ consumer is blocked without that data. Default position: accept that Buddy-era data starts at Phase 0a's deploy date. Phase 0 had no live consumer; missing data has no current cost.

### 3.3 — Acceptance criteria

- Migration `0025_buddy_phase0.sql` applied to the live DB; 17 tables exist in production.
- Live `learner_state_cache` populated for at least one active user, observed in Supabase.
- Dual-write status confirmed and documented: succeeding silently, failing silently, or no-op'd.
- No regression in existing review-submit latency (verified against a baseline percentile).
- Internal observability counters visible (logged or dashboard); no alarms required for Phase 0a.

---

## §4 — Refreshed phase plan

### 4.1 — Revised ordering rationale

The April design's §14 phase plan is updated with current status and revised scope. **Ordering is changed from the April default to constructivist-first.**

**April order (paraphrased from §14):** 0 → 1 (templates) → 2 (on-device) → 3 (orchestration) → 4 (social) → 5 (co-creation) → 6 (Study Log) → 7 (onboarding) → 8 (MCP) → 9 (Claude) → 10 (Android).

**Refresh order:**
> 0a (cleanup) → 1' (BuddyCard delivery skeleton) → **5 (Contextual Mnemonic Co-Creation — pulled forward as the signature pedagogical payoff)** → 6 (Study Log to house the artifacts of 5) → 3 (Orchestration with R(t) re-anchor) → 4 (Social) → 7a (Buddy onboarding augmentation) → 2 (Apple Foundation Models, deferred) → 8–10 (post-MVP, as in April).

Reasons for the re-order:

1. **Mnemonic co-creation is the signature feature** per §7 of the April design. Pulling it forward makes Buddy feel like *Buddy* — not like a notifier — fastest.
2. **The existing pre-Buddy mnemonic system is unsatisfying.** The current AI-generated stock mnemonics don't resonate as personal hooks (operator-tested over months of use). The sooner we replace them with the co-creation flow, the better the learner experience.
3. **Phase 3 is partly served by Spec 1's Practice Loop.** Deferring it costs less today than the April plan assumed.
4. **On-device LLM (Phase 2) is bridge-engineering** without immediate user-visible benefit beyond cost. The cloud path (Groq + Gemini, validated by tutor-analytics) is live. Defer until after Phase 4 — re-evaluate then based on actual cloud-LLM cost trends and Apple Foundation Models maturity.

### 4.2 — Per-phase summary

| # | Phase | Status / Revision |
|---|---|---|
| 0 | Foundation | Partly shipped (see §2.4). Completed by Phase 0a (§3). |
| **1'** | **Template + light-LLM Buddy delivery** | Scope evolved from April Phase 1: the "no LLM calls" constraint relaxes — LLM router is live and validated. What ships: BuddyCard component, three placements (Dashboard, Study, Progress), Watch nudge delivery (re-using existing push pipeline), frequency caps (3/day Watch, 1/day social per April §10), template-driven *delivery* (cadence, schedule, dedup), with optional Tier-1/2 LLM enrichment of nudge body text. Tier-3 (Claude) for user-initiated calls remains gated on the business-model decision (see Phase 9). Brainstorm: separate spec. |
| **5** | **Contextual Mnemonic Co-Creation** | **Supersedes** the existing pre-Buddy mnemonic system. Existing pre-Buddy mnemonic data: **discarded** (operator decision — does not resonate as memory hooks). Schema: extend `mnemonics` table with `cocreation_context jsonb` (the `CoCreationSession` shape already defined in [`buddy-types.ts`](../../../packages/shared/src/buddy-types.ts)). 5-stage flow (consent → location inference → detail elicitation → assembly → commitment) per §7 of April design. Brainstorm: separate spec. |
| **6** | **Study Log (enhanced Journal)** | Journal tab repurposed as the Study Log per §8 of April design. Phase 5's co-creation artifacts surface here as the primary content. Existing journal/mnemonic UI is replaced. Brainstorm: separate spec. |
| **3** | **Study Orchestration Engine** | **Major rewrite from April.** The loop already exists (Practice Loop). Phase 3 = (a) put Buddy in the seat: replace or augment the Practice Loop's rule-based routing with Buddy-mediated routing; (b) **re-anchor leech detection on FSRS R(t)** instead of `lapseCount >= 3` (§5 below); (c) confused-pair drills (not shipped by Spec 1, still in scope). Open sub-decision: replace vs augment (see §7). Brainstorm: separate spec. |
| **4** | **Social Learning** | Unchanged from April §10. Seven nudge categories, framing rules, shared goals, rescue calls. Friend/study-mate infra exists; this phase wires Buddy into it. Brainstorm: separate spec. |
| **7a** | **Buddy onboarding augmentation** | Base onboarding shipped in April–May (the [`2026-04-13-onboarding-tutorial-questionnaire.md`](../plans/2026-04-13-onboarding-tutorial-questionnaire.md) work). Phase 7a augments with: (i) "Meet Buddy" intro card for existing users on first launch post-rollout; (ii) Buddy's role explanations woven into the existing onboarding flow at appropriate steps; (iii) per-user personality preference capture (encouraging / direct / playful per §4 of April design). Materially smaller than April Phase 7. |
| 2 | Apple Foundation Models | Scope unchanged; deferred until after Phase 4. iOS 26 has shipped publicly; the React Native bridge work is real but no longer time-critical. Re-evaluate timing once Phase 1'–4 have shipped and cloud-LLM cost is measurable in real usage. |
| 8 | MCP Server (internal) | Unchanged from April §12, §14; post-MVP. |
| 9 | Claude Integration (premium tier) | Already partly live — `TutorAnalysisService` calls Claude (Tier 3) by bypassing the premium gate as a system-initiated call. Premium-gating for *user-initiated* Claude calls remains open and is gated on the business-model decision in §16 of April design. |
| 10 | Android | Unchanged; post-MVP. |

---

## §5 — Leech detection re-anchor (FSRS R(t))

The April spec defines a leech as a kanji with `lapseCount >= 3` and `status != burned`. Under SM-2 (where Hard/Again forced an interval reset to 1 day), this was a sound proxy for "this kanji isn't sticking." Under FSRS, lapses still happen, but the spectrum is wider — a kanji with stability dropping but no formal lapse is also struggling.

### 5.1 — Refreshed leech predicate

```
isLeech(card, now) =
  card.status != 'burned'
  AND (
    card.lapses >= 3                                  // legacy coarse signal (kept as a filter)
    OR retrievability(card, now) < 0.6                // primary FSRS signal
  )
```

The 0.6 threshold is a starting position — the FSRS-recommended danger-zone marker. Phase 3's spec confirms the exact threshold and decides whether to D-modulate it (Spec 1.5 has a `0.85 + 0.01·(D − 5)` precedent in the `maybeSlipping` predicate that the Practice Loop uses to gate the quiz leg).

### 5.2 — Side benefit: severity gradient

FSRS R(t) is continuous; `lapseCount` is discrete. Continuity gives Buddy a *severity gradient* — how much a card is struggling, not just whether. This unlocks the §7 April design's "after repeated failures despite the personalized hook does Buddy offer to rebuild from scratch" — a card whose R(t) decays *despite* an existing mnemonic is a candidate for rebuild, regardless of how many formal lapses it's logged.

### 5.3 — Update path

The change is local to [`services/buddy/constants.ts`](../../../apps/api/src/services/buddy/constants.ts) and its callers. Phase 0a does **not** make this change (Phase 0a is plumbing-only); Phase 3 does. Until Phase 3 ships, the lapse-based predicate remains the only leech signal — but nothing currently consumes it anyway (the leech-detection callsite doesn't exist yet).

---

## §6 — Buddy voice/framing refinements

Two refinements emerged in conversation since April. Both are evolutions of §4 of the April design ("Who Buddy Is"), not replacements.

### 6.1 — "Kanji monkey off your back" framing

The April spec defines Buddy as a friend; the refresh adds an **aspirational framing** for what Buddy is *for*: helping the learner finally get the proverbial kanji monkey off their back. Kanji literacy is the steepest climb for non-CJK-background learners; Buddy is the companion who guides along the shortest path to the top.

A `KanjiBuddyMonkey` asset exists in the repo root. **Whether Buddy *is* the monkey (the burden Buddy embodies and helps you bear) or *helps you shoo the monkey away* (the antagonist Buddy fights alongside you) is deliberately unresolved here.** Phase 1' or Phase 5's brainstorm settles it. Both readings are live; they imply different tones (companion-as-burden-bearer vs companion-as-protector).

### 6.2 — JSL audience scoping

Buddy assumes the learner is approaching Japanese **as a second language**, without prior CJK literacy. Kanji is the steepest part of the climb specifically for that audience. Native Chinese readers face a different problem — re-mapping known characters onto Japanese phonology and semantics — which Buddy doesn't optimize for.

This is an implicit assumption in the April spec; the refresh makes it explicit:
- Mnemonic co-creation (Phase 5) anchors hooks in *non-kanji* existing knowledge.
- Explanations (Phase 5 + ambient Phase 1' nudges) don't assume hanzi familiarity.
- Onboarding (Phase 7a) doesn't try to be useful to a native-CJK learner who already has the character set.

---

## §7 — Open sub-decisions deferred to phase-level brainstorms

The refresh deliberately leaves these for the phase-level specs to settle. Listed here so each phase's brainstorm starts pre-loaded:

| Phase | Open sub-decision |
|---|---|
| 1' | Which surfaces get BuddyCard first — Dashboard, Study Ready screen, Progress, or all three? |
| 1' | Frequency cap discipline: hard cap on nudges/day or soft? Watch parity: same nudges or curated subset? |
| 1' | Existing-user "Meet Buddy" intro: one card at first launch, or part of a refreshed onboarding flow that 7a delivers? (7a moves later than 1' in this refresh, so 1' may need to ship a minimal version.) |
| 5 | Buddy ↔ monkey identity (§6.1) — companion-as-burden-bearer or companion-as-protector? |
| 5 | Existing pre-Buddy mnemonic data: **discard entirely** (operator decision, per §4.2). Phase 5 confirms the destructive-migration plan. |
| 5 | Location consent UX: ask upfront in onboarding (requires 7a coupling), or just-in-time when the first co-creation triggers? |
| 6 | Existing journal entries (if any in production): migrate visibly, hide, or delete? |
| 3 | Buddy *replaces* Practice Loop routing vs *augments* it. Recommended position: **augment first, replace later** — easier rollback, less risk to a shipped feature. |
| 3 | Exact R(t) threshold for leech detection (0.6? D-modulated?). |
| 4 | Friend-data privacy stance: covered by April §10 framing rules; Phase 4 spec confirms before any social nudge ships. |

---

## §8 — What this document does NOT change

For unambiguity:

- **The April design (§1–17) stands.** Vision, theoretical foundation, character, learning loop concept, scaffolding levels, signature feature definition, Study Log concept, Watch as learning partner, social learning principles, three-tier LLM architecture, UKG/MCP portability, privacy posture, success metrics — all unchanged.
- **The April technical spec stands** modulo the leech-detection re-anchor (§5) and the Phase 0a clarifications (§3). All other technical detail (DB schema, API endpoints, mobile integration patterns) is current.
- **The Phase 0 plan stays as the historical record** of what Phase 0 was meant to land. Phase 0a (§3) completes what was started; the original plan doc is not rewritten.

---

## §9 — Next steps

In rough order:

1. **Commit this refresh doc** (end of this brainstorm session).
2. **Phase 0a brainstorm + implementation plan.** Small enough that the brainstorm and plan may be one session.
3. **Phase 0a implementation + rollout** (clone-rehearsal pattern per the FSRS runbook).
4. **Phase 1' brainstorm** — BuddyCard delivery skeleton. Settles open sub-decisions in §7 for Phase 1'.
5. **Phase 1' plan + implementation + rollout.**
6. **Phase 5 brainstorm** — Contextual Mnemonic Co-Creation. The signature feature.
7. **Phase 5 plan + implementation + rollout.**
8. Subsequent phases per the refreshed ordering in §4.1.

This document is the umbrella. Each phase gets its own brainstorm → spec/plan → ship cycle.

---

*End of refresh document. See [`2026-04-09-kanji-buddy-design.md`](2026-04-09-kanji-buddy-design.md) and [`2026-04-09-kanji-buddy-spec.md`](2026-04-09-kanji-buddy-spec.md) for the canonical Buddy v2 design and spec.*
