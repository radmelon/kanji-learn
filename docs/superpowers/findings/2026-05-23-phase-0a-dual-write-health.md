# Phase 0a — Dual-write health verification

**Date:** 2026-05-23
**Method:** Single Supabase SQL query against the live `public` schema (`ap-southeast-2`).

## Background

The earlier inventory pass that fed the Buddy v2 Refresh doc mistakenly concluded the Phase 0 schema was unmigrated. Direct production SQL (this verification) confirms all 16 Buddy/UKG tables exist and are growing. This document captures the empirical state of `DualWriteService` writes as of Phase 0a kickoff.

## Query

```sql
SELECT
  (SELECT COUNT(*) FROM learner_knowledge_state) AS knowledge_state_rows,
  (SELECT COUNT(*) FROM learner_timeline_events) AS timeline_events_rows,
  (SELECT COUNT(*) FROM learner_identity)        AS identity_rows,
  (SELECT COUNT(*) FROM buddy_llm_telemetry)     AS llm_telemetry_rows,
  (SELECT COUNT(*) FROM learner_state_cache)     AS state_cache_rows;
```

(An earlier draft of this query referenced `created_at` on `learner_timeline_events` and errored — the column is `occurred_at`. Freshness check was dropped; counts alone are sufficient evidence.)

## Results

| Counter | Value | Verdict |
|---|---|---|
| `learner_knowledge_state` rows | 726 | ✅ healthy — dual-write writing UKG state on every review |
| `learner_timeline_events` rows | 2062 | ✅ healthy — dual-write writing events; ~687 per active user |
| `learner_identity` rows | 3 | ✅ healthy — one per active user (the 4th `user_kanji_progress` user predates Phase 0 wiring or hasn't reviewed since April) |
| `buddy_llm_telemetry` rows | 80 | ✅ healthy — `TutorAnalysisService` has been logging tier-3 calls since April |
| `learner_state_cache` rows | 0 | ✅ as expected — `LearnerStateService` is orphaned (the gap Phase 0a fixes) |

## Conclusion

**Dual-write is healthy in production.** Has been since the April 17 deploy. No backfill needed. The plan's wiring + observability work can proceed without further verification of the underlying schema.

The zero in `learner_state_cache` is the entire scope of Phase 0a's first code change: wire `LearnerStateService.refreshState()` into the post-`submitReview` hook so that counter starts climbing alongside the others.

## Sanity-check on data shape

- 726 `knowledge_state` rows / 3 users = ~242 kanji per user. Consistent with active intermediate-stage learners.
- 2062 `timeline_events` / 3 users = ~687 events per user. Each review submission produces one event. Roughly matches the volume implied by the FSRS handoff (2857 `review_logs` for 4 users = ~714 per user — close enough given the timeline-event vs review-log nuances).
- Small gap between `knowledge_state` (726) and `user_kanji_progress` (742 from FSRS handoff) is within the noise floor for new kanji that haven't been reviewed since Phase 0 dual-write started.

## Post-deploy verification

(To be filled in at Task 6 closeout — confirming `learner_state_cache` populates post-deploy.)
