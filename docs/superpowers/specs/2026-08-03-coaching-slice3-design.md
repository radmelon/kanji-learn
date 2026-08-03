# Coaching analyzer slice 3 — analysis mode: Buddy speaks the findings

> **Canonical URL — hand this to a new session:**
> https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-08-03-coaching-slice3-design.md

Parent spec:
https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-08-01-buddy-coaching-analysis-design.md

Slice 2 (merged, PR #11, deployed 2026-08-03):
https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-08-02-coaching-slice2-design.md

Slice 3 is §12's third slice: *"the conversational surface — the prompt module,
analysis mode in the weekly session, and the LLM voice over slice 1's
findings."*

---

## 0. What this slice is, and what it deliberately is not

**Analysis mode only.** Companion mode is slice 4 and nothing here presumes its
shape.

That boundary is worth defending, because §5 says companion mode is *"not a
fallback, it is the common case"* — most weeks have no materially new finding.
So a learner will often open the weekly session and get today's behaviour rather
than coaching prose. **That is expected.** Slice 3's job is to prove the
prompt → router → fallback spine on the weeks something *is* worth saying, and
to produce the real cost-per-turn measurement §11.3's cap decision is waiting
on. Widening it to keep the surface busy would merge two slices §12 explicitly
separates.

### Three of the four "open decisions" do not bind this slice

The 2026-08-03 handoff listed four decisions blocking slice 3. Re-reading §12
against what analysis mode actually is, only one of them does.

| Decision | Binds slice 3? |
|---|---|
| Tier 1 is a server-side stub | **No.** Settled here by targeting tier 3 (§5), and the stub only matters for per-turn traffic. |
| Server vs client for cheap turns | **No.** That is about companion mode's per-turn economics. Analysis mode is **one call per week**. |
| Cap degradation | **No** — analysis mode already has §1's template floor. It is companion mode that has none. |
| §11.4's `CoCreationSheet` interaction | **No**, given the scope above — the offer is rendered as text, not as an interaction. Still owed before slice 4. |

**The `RefreshResult` overload is also not a blocker**, for a specific reason
recorded in §7.

---

## 1. Architecture

| File | Responsibility |
|---|---|
| `apps/api/src/services/buddy/coaching-prompt.ts` | **Create.** `buildCoachingPrompt(input): string` — pure, no I/O, no clock. Mirrors `meeting-prompt.ts`. |
| `packages/db/supabase/migrations/0035_session_utterances.sql` | **Create.** `buddy_session_utterances`. |
| `apps/api/src/services/buddy/coaching-voice.service.ts` | **Create.** Cache read → prompt → `llm.route()` → cache write → return. Owns the fallback. |
| `apps/api/src/routes/buddy-session.ts` | **Modify.** In the `due` branch only. |
| `apps/api/src/services/llm/types.ts` | **Modify.** Add the new context to `RequestContext` and to `TIER3_CONTEXTS` — see §5. |
| `apps/mobile/src/lib/buddy-session-state.ts` | **Modify.** New card kind, preferred over `opener`/`reckon`. |

`meeting-prompt.ts` is the precedent to follow, not merely to resemble: 27
lines, a pure function returning a string, beat goals as a `Record`, no service
dependencies. `coaching-prompt.ts` should be recognisably its sibling.

### ⚠️ Slice 3 touches mobile — unlike slice 2

`apps/mobile/src/lib/buddy-session-state.ts` turns the session response into
typed cards (`{kind:'opener'}`, `{kind:'reckon'}`). Rendering one composed
utterance means changing that reducer, so **this slice needs an EAS build to be
seen.** The reducer itself is pure and belongs in the mobile *pure* lane
(`--runInBand`), mirroring `useCoCreation.reducer` — so the logic is testable
without a build even though the visual result is not.

---

## 2. Where the voice applies — the session, never the notebook

**The notebook entry stays exactly as slice 2 writes it: template prose.**

The notebook is the durable **record**; the session is the **conversation**.
Two renderings of the same findings, each suited to its surface.

This keeps §1's floor structurally intact rather than by policy. If the LLM also
rewrote the notebook entry, the record would vary with LLM availability — the
same findings reading differently across two opens — and the superseded chain
that §4 calls *the trajectory* would fill with prose variation rather than
genuine change. Slice 2 went to real trouble to make that chain meaningful; an
LLM in the write path would undo it.

**Consequence to hold onto:** an LLM outage degrades the conversation and never
the record.

### The common case: no findings at all

**When `select()` returns nothing, no LLM call is made and no `voice` field is
returned.** The response is exactly today's payload, and the client renders
`opener` and `reckon` as it does now.

This is stated explicitly because §5 says it is the *common* case, not an edge
case — most weeks have no materially new finding. An implementation that called
the LLM to say "nothing much this week" would spend a tier-3 call per learner
per week to produce filler, and would put prose in front of a learner on exactly
the weeks there is nothing to report. Silence here is slice 4's problem to
solve, deliberately.

---

## 3. One utterance, not three

The `due` response already carries `opener` and `reckon` as separate template
strings. Adding findings would make three voices in one payload.

**The LLM composes a single utterance from all three.** It receives the opener
kind, the reckoning text, and the selected findings, and returns one thing Buddy
says. The learner hears one voice rather than three stitched fragments, which is
what "analysis mode" implies.

---

## 4. The prompt contract

### What the LLM receives

- The **opener kind** and its template text.
- The **reckoning** text, or null when there is no previous period.
- The **selected findings**, each with `kind`, `magnitude`, `confidence`,
  `since`, and its `Evidence` array of `label`/`value` pairs.

### What it must never receive, and never do

- **No database rows.** §1's load-bearing invariant: *"The LLM sees these
  [Evidence]; it never sees a row."*
- **No new arithmetic.** `Evidence.label` is display-safe text already computed
  in slice 1, precisely *"so the voice layer has nothing left to calculate."*
  The prompt must say so explicitly. A model that recomputes a percentage from
  raw values can produce a number that contradicts the notebook.
- **No `mechanics_explainer`.** See below.

### 🛑 `mechanics_explainer` is filtered out before the prompt is built

§3 is unambiguous: it is *"template, always, never LLM. Buddy must not improvise
about his own algorithm, so this string is the whole finding."* `copy.ts:51`
already enforces this by returning the base string with no hedging and no
escalation.

But it is a `Finding` like any other, so `select()` can and will place it in the
top three.

**Rule: remove it from the finding list before building the prompt, and append
its exact template string after the composed utterance.** The LLM never sees it,
so paraphrasing it is structurally impossible rather than instruction-dependent.

The alternative — passing it in as a must-quote-exactly block — was rejected
deliberately. It relies on instruction-following for a *correctness* property,
a paraphrase would be Buddy confidently misdescribing his own internals, and
§10 forbids tests that assert LLM prose, so nothing would catch it.

**Accepted cost:** a visible seam between warm prose and the fixed explainer.
That is arguably correct — it *is* a different kind of statement, and §7 already
treats the explainer as a trust feature rather than a content feature.

### Output shape

Plain prose, not JSON. `meeting-prompt.ts` asks for JSON because it needs a
`patch` alongside the reply; analysis mode has no structured payload to extract,
and a wrapper would add a parse-failure mode for nothing.

---

## 5. Tier and cost

**Register the coaching utterance as a tier-3 context**, alongside
`deep_diagnostic` in `TIER3_CONTEXTS` (`apps/api/src/services/llm/types.ts:43`).

`BuddyLLMRouter.route()` then does the right thing with no branching: an
opted-in learner is served by Claude, and everyone else falls through to tier 2
automatically. This is the output where quality matters most — the moment a
learner is told something true about their own progress — and it runs once a
week against a 5/day cap.

**Not tier 1.** The server's tier-1 provider is `AppleFoundationStubProvider`,
which always reports unavailable and throws if asked to generate, so a tier-1
context would fall through to tier 2 while pretending to be on-device. See the
parent spec's §11.3 update of 2026-08-03.

**Cost, concretely:** one call per learner per week, because of §6's cache. That
is what makes §11.3's unsized cap a non-issue *for this surface* — and it is
also why this slice is the right place to take the first real cost-per-turn
measurement.

---

## 6. Caching — one utterance per session period

`buddy_session_utterances`, unique on `(user_id, week_start)`, holding the text,
the model that produced it, and a timestamp.

**Why cache at all:** `GET /v1/buddy/session` is called every time the learner
opens the app on their Buddy day. Without a cache, Buddy says something
*different* every time they look, and each look costs a call. The codebase
already holds this position — `pickHookCandidate` breaks ties deterministically
because *"a coach that suggests a different kanji each time you reload is not a
coach."* The same reasoning applies to his words.

**Why its own table** rather than reusing `buddy_commitments.method` (an unused
jsonb column whose `(user_id, week_start)` key is exactly right): `method` means
*how the commitment was arrived at*, so a future reader would find Buddy's
spoken analysis in a column named for something else, and `setForWeek`'s upsert
could clobber it. A dedicated table also gives "what Buddy said each week" as a
queryable history for free.

**Invalidation: none.** The key is the session period; a new period is a new
row. There is deliberately no TTL — the weekly session is a weekly moment, and a
second time constant on top of slice 2's staleness and coalescing windows would
be three windows to reason about for no behavioural gain.

---

## 7. Where the findings come from

The `due` branch calls **`coaching.refresh(userId, { force: true })`** and uses
the `findings` it returns.

`force` matters here for a specific reason. `RefreshResult.written: 'skipped'`
is overloaded across three outcomes — staleness-gated, empty selection, and lost
race — and **the staleness-gated path returns `findings: []` while a live entry
full of findings sits in the database.** A surface rendering from an unforced
`RefreshResult` would show an empty coaching state on every gated read. Forcing
bypasses the staleness gate, so `findings` is always accurate at this call site.

**This is a workaround, not a fix.** The overload should still be tightened
before slice 4, which will have call sites that cannot force. Recorded in the
slice 2 spec's §11.

`force: true` also means one snapshot assembly per weekly session — seven table
reads, once a week. Not a hot path.

**Interaction to be aware of, not a defect:** `refresh` *writes*, so a due
session GET also refreshes the notebook entry. Under slice 2's rules an
unchanged selection updates that row in place — only `analyzedAt` moves — so
repeated opens on the same Buddy day do not grow the superseded chain. Its
coalescing check keys off the row's `created_at`, which for an established
learner is days old, so a forced session refresh is correctly treated as an
ordinary run rather than a coalescing episode.

---

## 8. The response stays backward-compatible

`opener` and `reckon` remain in the payload, untouched. The utterance is
**additive**:

```ts
voice: { text: string; source: 'llm' | 'template' }
```

An old client keeps working and renders two cards. An updated client renders one
`voice` card instead. No breaking change to a shipped surface.

`source` is deliberately part of the response rather than logs only: it makes
the fallback observable from the client, and it is what an integration test
asserts to prove the template path ran without asserting any prose.

---

## 9. Failure is the template, always

Every failure mode lands on the same path: **`openerCopy` + `reckonCopy` +
`analysisBody(findings, now)`** — today's surface plus slice 2's prose, with
`source: 'template'`.

| Failure | Handling |
|---|---|
| Tier-2 cap reached (`BuddyLLMError`) | Template |
| Both tier-2 providers fail | Template |
| Empty or whitespace-only output | Template |
| Output over a sanity length bound | Template |
| Cache write fails | Return the utterance anyway; log |

**Strictly better than the current surface, never worse.** That is the property
worth protecting: slice 3 cannot regress the weekly session, because its worst
case is the session as it ships today with slice 2's findings appended.

⚠️ **`analysisBody` must be called with `now`.** `copy.ts:62` reads
`if (!now || days >= ESCALATE_AFTER_DAYS)`, so omitting it escalates every
finding that has a `since` regardless of age — silently, with no other test
failing.

---

## 10. Testing

Per §10 of the parent spec: **no test asserts LLM prose.** *"The contract under
test is that the LLM is handed the right findings and that template output is
correct without it."*

| Lane | Covers |
|---|---|
| Shared | Nothing new — slice 1 owns the findings, slice 2 owns `analysisBody`. |
| API integration | `buildCoachingPrompt` receives exactly the selected findings; **`mechanics_explainer` never appears in the prompt string**; the template fallback is produced with the router stubbed to throw, and reports `source: 'template'`; a second `due` GET returns identical text with no second router call; the migration's unique key rejects a duplicate `(user_id, week_start)`. |
| Mobile pure | The card reducer prefers `voice` when present and falls back to `opener`/`reckon` when absent — both directions. |

**Name the mutation each test catches.** Slice 2's retrospective found that its
plan specified test *code* without specifying what each test was meant to
disprove, and reviewers found real gaps in every task as a result. A test that
cannot fail is worse than a missing one.

---

## 11. Out of scope

- **Companion mode** — slice 4, and nothing here constrains its shape.
- **The §11.4 `CoCreationSheet` interaction.** `hook_coverage`'s offer renders
  as text with the named kanji slice 1 already picks. Whether the sheet opens
  over the session or the session hands off is a slice 4 design problem.
- **The §11.3 cap number.** This slice produces the measurement it needs.
- **Client-side on-device generation.** The option is real and recorded in the
  parent spec, but it is a slice 4 decision about per-turn economics.
- **Notebook prose.** §2.
- **Tightening `RefreshResult`.** §7 explains why slice 3 does not need it.
