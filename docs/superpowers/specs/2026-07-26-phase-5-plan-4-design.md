# Phase 5 — Plan 4: Reinforce, Recall & Surfacing (Design)

**Date:** 2026-07-26
**Status:** Design approved, ready for `writing-plans`
**Parent spec:** [`2026-05-31-phase-5-mnemonic-cocreation-design.md`](2026-05-31-phase-5-mnemonic-cocreation-design.md)
**Predecessor plans:** Plan 1 foundation (`d78ad1f`) · Plan 2 data/API (`0498953`) · Plan 3a on-device (`97321b8`) · Plan 3b logic + UI (`phase-5-cocreation-ui`, unmerged at `80b521c`)

---

## 1. Summary

Plan 4 is the final Phase 5 slice. It completes the contextual mnemonic co-creation loop — a hook can now be **tested**, **reinforced**, **deepened**, and **used at the moment of need** — and it removes the last obstacle to deploying the Plan 2 API.

The create half already works and is device-verified (Plan 3b walkthrough, 2026-07-05). What's missing is everything after creation: a hook is built, and then nothing ever happens to it.

---

## 2. Scope

**In scope** — the five items Plan 3b deferred (`2026-06-03-phase-5-mobile-cocreation-flow.md:17`), plus two additions decided in this session:

1. Reinforce + deepen UI (parent spec §4.3, §6)
2. The `mnemonic_recall` story→kanji quiz (§8)
3. Surfacing — `MnemonicCard` refactor + flashcard answer side (§9)
4. "Mnemonic coaching" toggle + "Not now" 7-day cooldown persistence (§11)
5. Removing the old refresh-nudge mobile callers (§10.4) — *the deploy unblocker*
6. **`attach_location_to_hooks` privacy switch + first-time in-flow ask** *(added — closes a live privacy gap)*
7. **Hint button on the flashcard prompt side** *(added — see §8.2)*

Also folded in: the `location_inference` reducer cleanup (the missing "Looks like you're near X" line on the grant path — diagnosed during the 3b walkthrough as plan-level, not a bug).

**Explicitly out of scope.** These were attached to the "Plan 4" label because they surfaced during the same 2026-07-05 walkthrough, not because they belong to this project. Each gets its own spec:

| Item | Why separate |
|---|---|
| Buddy voice cloud TTS | New backend subsystem — synthesis + audio storage + cost story |
| `speakMixed` ja/en segmentation | App-wide shared TTS utility |
| Velocity rework + goal calculator | Dashboard motivation; unrelated to mnemonics |
| Study on the Go | New study mode; unrelated to mnemonics |
| Geo-triggered hook recall | Future feature; depends on §9's privacy switch landing first |
| BYOK settings UI | Pre-launch slice by prior decision (parent §7.4, §14) |

---

## 3. Decisions locked this session (2026-07-26)

| # | Decision | Rationale |
|---|---|---|
| D1 | Scope = 3b's five deferrals + privacy switch | "Plan 4" had accreted six unrelated subsystems. The hint button (D6) was added later in the same session |
| D2 | "Go deeper" = **one entry, two thread types** | `layers[].source` already types `'environment' \| 'known_knowledge'` |
| D3 | Restore retired endpoints as **deprecated no-ops** | Dissolves the deploy-ordering deadlock outright |
| D4 | **Deploy first, then build** (approach A) | Follows from D3; restores a shippable `main` on day one |
| D5 | Destructive cleanup still deletes **all** rows | Operator reaffirmed 2026-07-26, tester live. 24h dump is the recovery path |
| D6 | Hint button: **cap grade at Hard**, ~5s delay, flashcard only | Honest FSRS classification; self-correcting incentive |

---

## 4. Rollout architecture

### 4.1 The constraint, restated correctly

Two ordering rules have been conflated as one since June:

1. **New API breaks old mobile** — Plan 2 deleted `GET /v1/mnemonics/refresh` and `POST /v1/mnemonics/:id/refresh/dismiss`; shipped builds still call them.
2. **New mobile breaks old API** — the 3b UI calls `/assemble`, `/cocreated`, `/outcome`, `/deepen` and `buddy-moment-context`, which production lacks.

Rule 2 is real and forces API-deploy-before-or-with-the-build. **Rule 1 exists only because two routes were deleted**, and is fixed by restoring them as no-ops.

**Blast radius correction.** Prior handoffs record rule 1 as an unhandled 404 on `dismissRefresh`. Tracing it:

- `GET /v1/mnemonics/refresh` — **already guarded**. `useRefreshDue.load` wraps it in try/catch (`apps/mobile/src/hooks/useMnemonics.ts:130`); a 404 yields an empty list and Journal shows "No mnemonics due".
- `POST .../refresh/dismiss` — unguarded, but only reachable by tapping dismiss on a `MnemonicCard` whose `refreshPromptAt <= now` (`MnemonicCard.tsx:78`). After the cleanup, no such rows exist.

Real exposure is one narrow window: API deployed, cleanup not yet run. The stubs close it permanently.

### 4.2 The stubs

```
GET  /v1/mnemonics/refresh              → { ok: true, data: [] }
POST /v1/mnemonics/:id/refresh/dismiss  → 200, no write
```

Both marked `@deprecated`, with a comment naming **B143** as the last build that calls them. Delete only when no build in the wild predates their removal.

### 4.3 Order of operations

1. **Stubs + API deploy** — production gains the Plan-2 surface; B143 unaffected.
2. **Live DB** — safety dump → migration 0027 → destructive cleanup (runbook `2026-06-01-phase5-data-cleanup.md`). Migration 0026 + IDS backfill are already live (2026-07-05).
3. **Merge `phase-5-cocreation-ui` → `main`** — now safe. **`main` becomes shippable for the first time since June.**
4. **Build Plan 4 incrementally on `main`**, mobile typecheck green before every commit (SOP rule).
5. **Cut EAS** when the loop is complete.

Steps 1–3 are a single short session. The old design held `main` frozen for all of Plan 4 and landed every integration risk on one day; this lands them on day one, separately, each independently revertible.

**Expected observation, not a bug:** after step 2 the tester's Journal tab is empty and stays empty until they build their first co-created hook. Stock mnemonics are exactly what Phase 5 supersedes.

---

## 5. Migration 0027

Five columns, three tables, one migration:

| Table | Column | Type | Default |
|---|---|---|---|
| `user_profiles` | `attach_location_to_hooks` | boolean | `false` |
| `user_profiles` | `mnemonic_coaching_enabled` | boolean | **`true`** |
| `user_profiles` | `hook_location_ask_seen_at` | timestamptz | null |
| `user_kanji_progress` | `buddy_moment_snoozed_until` | timestamptz | null |
| `review_logs` | `hint_used` | boolean | `false` |

Notes:

- `mnemonic_coaching_enabled` defaults **on** — parent §11 specifies an opt-out (anti-nag), not an opt-in.
- The cooldown is **per kanji** (§11: "7-day cooldown for that kanji"), so it belongs on `user_kanji_progress`, not `user_profiles`.
- **The quiz needs no migration.** `testType` is `text('test_type')` (`packages/db/src/schema.ts:422`), not a PG enum, so `mnemonic_recall` is a new value in an existing column.

The two `user_profiles` booleans mirror the shipped `attach_location_to_milestones` pattern across its four layers: `packages/db/src/schema.ts`, `apps/api/src/routes/user-profile.schema.ts`, `apps/mobile/app/(tabs)/profile.tsx`, and the consuming hook.

---

## 6. Reinforce & deepen

### 6.1 Reinforce

Plan 3b returns `reinforce` from `pickBuddyMomentAction` and deliberately no-ops it (`3b plan:739`), so a session whose only candidate is a hooked-but-slipping kanji currently shows nothing. Plan 4 wires the real sheet.

Two taps and one judgement (parent §4.3):

1. Recall the scene → tap to reveal.
2. Recall the reading → tap to reveal.
3. One self-report: **👍 / Not really**.

That outcome drives the EMA. All three fields already exist on the `mnemonics` row — no schema change:

```
score ← 0.4 · outcome + 0.6 · score     // outcome = 1 (👍 / quiz correct), 0 (👎 / quiz wrong)
reinforcementCount += 1
lastReinforcedAt = now
```

### 6.2 Deepen

Gate: `reinforcementCount ≥ 2 AND effectivenessScore < 0.35`. From the 0.5 default, two unhelpful outcomes in a row trip it; a 👍 between them lifts the score and buys the hook more time. Also available proactively from kanji detail at any time.

**"Go deeper" is one entry point offering two thread types** (D2):

| Thread | Question | `layers[].source` |
|---|---|---|
| Add a detail | Personal detail / reading wordplay (the "stickier" questions) | `'environment'` |
| Connect it | "What does this remind you of that you already know cold?" | `'known_knowledge'` |

Either appends to `cocreation_context.layers[]`, increments `layerCount`, and resets `effectivenessScore` to 0.5 — a genuine fresh chance now there's more to hold onto. `reinforcementCount` keeps climbing as the full history of tending.

This resolves an ambiguity between the parent spec (§6.3: deepen = known-knowledge elicitation) and the walkthrough request (reopen the *stickier* inputs on a saved hook). They are different questions at a different moment; both are legitimate, and `layers[].source` was already typed for exactly this.

**Copy discipline:** never "rebuild", "start over", or "discard". Additive language only.

---

## 7. The `mnemonic_recall` quiz

Reuses existing machinery entirely — a new `test_type` value and a card layout, nothing more.

- **Existing plumbing:** the quiz leg is already in the loop (`review.store.ts:46`), and already records attempts to `testSessions` separately from the flashcard grade (`review.store.ts:258`).
- **The item:** prompt = the hook's story; response = 4–5 kanji tiles, one correct.
- **Distractors:** `selectDistractors` shipped in Plan 1 (`packages/shared/src/mnemonics/distractors.ts`). It prefers kanji sharing a component with the target — which became materially better on 2026-07-05 when migration 0026 filled `kanji.components` for 2264/2294 kanji. Falls back to same-JLPT-level kanji from the user's deck; never duplicates.
- **Scheduling:** stamp `cocreation_context.mnemonicQuizDueAt` on create or deepen → immediate quick-check right after `commitment` → early item in the next session containing that kanji.
- **Outcome:** correct bumps `effectivenessScore` and clears the stamp; wrong nudges it down and flags the kanji as a deepen candidate for the next Buddy moment.

**Resolves parent spec open question #4** (does next-session insertion disrupt minutes-budget pacing?). It does not, structurally: a freshly-hooked kanji is by definition one that was slipping — lapses ≥ 3, graded Again/Hard — so it routes flashcard → writing → speaking and never had a quiz leg to displace. The recall quiz is an *added* item. But at most one Buddy moment fires per session, so at most one hook is ever fresh, bounding the cost at a single extra tap-item per session. It is inserted front-loaded and counted against the minutes budget like any other leg.

---

## 8. Surfacing

### 8.1 Where hooks appear

1. **Kanji detail — canonical home.** Plan 3b shipped a stopgap (prefers the co-created hook over stale system rows, hides Regenerate). Plan 4 replaces it with the real `MnemonicCard` refactor: the layered story rendered as a stack, where it was born, how deep it's grown, plus the "Go deeper" entry from §6.2.

   *Convergence worth exploiting:* `MnemonicCard.tsx:210` is also where the refresh-dismiss button lives — the one unguarded caller of a retired endpoint. The surfacing refactor and the caller removal are the same edit to the same file.

2. **Flashcard — answer side.** `KanjiCard` shows the hook on flip. Kanji with no hook show nothing; there is no stock fallback, since stock mnemonics are what the cleanup deletes.

3. **Journal — untouched in v1.** Timeline / map / tags / photos / audio remain Phase 6.

### 8.2 The hint button (new)

Parent spec §9 says hooks never appear on the prompt side. That rule was written against **passive display** — a hook permanently on the question face means retrieval never happens. A **learner-pulled hint** is a different mechanism: the learner attempts retrieval, fails, and only then reaches for support. That is cued recall, and it beats both unaided failure and passive re-study.

It also closes a real usability hole. A hook exists so the learner has something to reach for when a kanji slips; showing it only *after* they've answered means the hook can never be used at the moment it's needed. It becomes a thing you review rather than a thing you use.

**Design:**

- **Flashcard prompt side only.** Not the writing leg — the hook names the components outright ("a hand beside a temple"), which is not a hint for a writing prompt but the answer. Not the speaking leg — the story embeds the reading (*もつ — motsu*). **Explicitly not the `mnemonic_recall` quiz either**, where the story *is* the prompt and a hint would be circular.
- **Appears after ~5s on the card**, fading in. This structurally enforces an unaided attempt without nagging copy. The exact delay is a tuning parameter — pin it as a named constant so it can be adjusted after the walkthrough without hunting through the component.
- **Only rendered when a co-created hook exists** for that kanji — self-limiting, since hooked kanji are the minority.
- **Taking a hint caps the grade at Hard.** Again and Hard remain available; Good and Easy are disabled.
- **Records `review_logs.hint_used`.**

**Why the cap matters.** It is not an arbitrary penalty: "recalled with difficulty" is precisely what Hard *means* in FSRS, so the cap is the honest classification of what happened. Without it there is a genuine data-integrity problem — a learner could hint, grade Easy, and push a card they could not actually recall out three weeks, quietly corrupting their own scheduling. It also makes hint-reliance self-correcting: a hint costs a shorter interval, so there is a real incentive to try unaided first, with no lockout and no guilt copy.

**Bonus signal.** Parent §15 parks "fold real post-hook behavior into `effectivenessScore`" as future work. Hint usage gets there more directly than the self-report does — hint taken then remembered means the hook worked at the moment of need; hint taken and still missed means it is not doing its job. Behavioral rather than self-reported, and it arrives with every review instead of only at Buddy moments. **Plan 4 records the signal but does not yet feed it into the EMA** — that stays deferred, so the scoring model changes in one deliberate step rather than as a side effect.

---

## 9. Consent, cooldown, privacy

**Coaching toggle.** Profile setting "Mnemonic coaching", default **on**. Off → no automatic Buddy moments; manual "Build a hook" stays available. A learner who dislikes the end-of-session interruption loses the interruption, not the feature.

**"Not now" cooldown.** Plan 3b closes the sheet and forgets (`3b plan:657`). Plan 4 stamps `buddy_moment_snoozed_until = now + 7d` on that kanji, and `pickBuddyMomentAction` filters against it — the hook 3b left at line 697. Accepting an offer clears it.

**Location switch + first-time ask** (operator decision, 2026-07-05). Co-created hooks store GPS coordinates gated only by the app-wide iOS permission, so a user who granted location for milestones silently opts into hook coordinates too. Rather than bury the control in Profile where a new learner would never find or understand it, Buddy asks **once, in-flow**, on first entry into co-creation, and uses the moment to explain what is stored and why. `hook_location_ask_seen_at` is server-side so a reinstall does not re-ask. Thereafter the switch governs absolutely:

| State | Behavior |
|---|---|
| OFF | Skip GPS inference; typed "Where are you right now?" only; no coordinates stored; never re-ask |
| ON + permission undetermined | iOS dialog fires mid-flow, right after "Let's do it" |
| ON + permission denied | Typed question (re-enable lives in iOS Settings) |

**`location_inference` reducer cleanup.** The grant path never renders its "Looks like you're near X" line because the inferred place name does not reach the UI. Diagnosed during the 3b walkthrough as plan-level and deferred here.

---

## 10. Testing strategy

Extends parent §13; does not replace it.

**`packages/shared` (pure unit, TDD).** Plan 1 already carries most of the weight — cadence math, the deepen gate, distractor selection and trigger selection all have shipped tests. Plan 4 *consumes* those rather than rewriting them. Genuinely new pure logic, each written test-first:

- Hint-to-grade cap — hinted card offers only Again/Hard; unhinted unaffected.
- Cooldown eligibility — snoozed kanji excluded; expiry restores; accept clears.
- Quiz insertion — front-loaded placement, one-off slotting when the kanji is not otherwise due.

**`apps/api` (integration).**

- `effectivenessScore` update from a quiz outcome and from a reinforce outcome.
- `cocreation_context` jsonb survives a round-trip with `layers[]` populated — guards the Phase 1' double-encoding footgun.
- **Deprecated stubs return the exact shapes B143 expects.** Their entire job is to not break a build we can no longer change, so this assertion is load-bearing.
- Clone-rehearsal of the destructive cleanup before it touches live.

**Manual on-device walkthrough** (operator's iPhone 15 Pro), extending §13 with the new behaviors:

- Hint button: does not appear before ~5s; appears only on hooked kanji; Good/Easy disabled after use.
- "Go deeper" offers both thread types; each appends a layer and resets the score.
- First-time location ask fires once; OFF path never re-asks; reinstall does not re-ask.
- Coaching toggle off actually suppresses Buddy moments while manual "Build a hook" still works.
- Reinforce challenge at end of session; deepen offer after two 👎.
- Grant path now shows "Looks like you're near X".

---

## 11. Risks & carry-forward

| Risk | Mitigation |
|---|---|
| Destructive cleanup is irreversible after 24h | `pg_dump` safety dump; clone-rehearsal first; operator reaffirmed D5 |
| Tester's Journal goes empty | Expected (§4.3); brief them so it is not filed as a bug |
| Stubs forgotten and deleted too early | `@deprecated` comment names B143 as the gate; integration test asserts the shape |
| Hint over-reliance | Grade cap makes it self-correcting; 5s delay enforces attempt-first |
| Merging 3b to `main` ships a half-complete feature | Acceptable — create flow is device-verified and standalone; gives the live tester real feedback surface while the rest is built |

**Unrelated but live:** daily push notifications have been broken since April (`BUGS.md:250`). An outside tester is now active. Not Plan 4's scope, but it deserves its own session and should not wait behind Phase 5.

---

## 12. Parent-spec open questions, resolved

| # | Question | Resolution |
|---|---|---|
| 1 | Does `kanji.radicals` hold full decomposition? | **Resolved 2026-06-03** — use IDS, not KRADFILE. `kanji.components` backfilled via migration 0026 (2264/2294, live 2026-07-05) |
| 2 | Community Expo module for Apple Foundation Models? | **Resolved 2026-06-03** — `@react-native-ai/apple@0.12.0`, direct `AppleFoundationModels` TurboModule. On-device verified |
| 3 | BYOK UI in v1? | **Resolved 2026-05-31** — pre-launch slice, not v1 |
| 4 | Quick-check + next-session quiz both in v1; pacing? | **Resolved here (§7)** — yes to both; bounded at one extra tap-item per session |
