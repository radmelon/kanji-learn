# 漢字 Buddy — Enhancement Roadmap

A phased development plan for all unimplemented enhancements. Grouped by impact and logical development order. Reference phases by number (e.g., "Phase 1, item 2") when starting work.

---

## Phase 0 — Security ✅ COMPLETE
*Deployed to prod 2026-04-11. PR #1 merged.*

| # | Enhancement | Impact | Backend | Status |
|---|------------|--------|---------|--------|
| S1 | Enable RLS on All Public Tables | Critical | Yes | ✅ Done |
| S2 | Restrict Sensitive Column Exposure (user_profiles) | Critical | Yes | ✅ Done |

**Why first:** These are not enhancements — they are security vulnerabilities. Anyone with the Supabase project URL can currently read, edit, and delete data in 12 of 13 tables. The `user_profiles` table exposes emails and push tokens. This must be fixed before any other work.

**Implementation plan:**
1. Create a new migration that runs `ALTER TABLE <name> ENABLE ROW LEVEL SECURITY` on all 12 unprotected tables
2. Add user-scoped SELECT/INSERT/UPDATE/DELETE policies (`auth.uid() = user_id`) for: `user_profiles`, `user_kanji_progress`, `review_sessions`, `review_logs`, `daily_stats`, `writing_attempts`, `voice_attempts`, `test_sessions`, `test_results`
3. Add user-scoped + limited public read policies for `mnemonics` (system mnemonics are public, user mnemonics are private) and `friendships` (visible to requester and addressee only)
4. Add service-role bypass policies where the API server needs write access (interventions, daily_stats, mnemonics)
5. For `user_profiles`: create a restricted policy that only exposes `id` and `display_name` to other authenticated users (for leaderboards/friends); full profile access only to `auth.uid() = id`
6. Test all API endpoints to ensure service-role operations still work
7. Test mobile app to ensure authenticated user operations work correctly

---

## Phase 1 — Quick Wins ✅ COMPLETE
*Deployed 2026-04-11.*

| # | Enhancement | Impact | Backend | Status |
|---|------------|--------|---------|--------|
| 1 | Dashboard JLPT Bars: Match Progress Page Style | Med | No | ✅ Done |
| 2 | Swipe Up/Down Grading (Watch Parity) | Med | No | ✅ Done (pre-existing) |
| 3 | Study Group: Top Performer Badge | Med | Yes | ✅ Done |
| 4 | Study Group: Expanded Shared Stats | Med | Yes | ✅ Done |

**Why first:** Immediate visible improvements, low risk, builds on shipped features. Items 3 & 4 share the same social service code and should be done together.

---

## Phase 2 — Core UX & Onboarding (M effort, High impact)
*Reduce churn, widen the front door, improve daily experience. These affect every user.*

| # | Enhancement | Impact | Backend | Status |
|---|------------|--------|---------|--------|
| 5 | OAuth 2.0 Social Login (Apple, Google) | High | Yes | ✅ Done — re-verified 2026-04-17 after B117/B118 fix bundle. The "regression" turned out to be a `useProfile` race + missing DB trigger, not OAuth itself. See BUGS.md. |
| 6 | Onboarding Tutorial + User Questionnaire | High | Yes | ✅ Done — merged into main via PR #6 |
| 12 | Delete Account ⚠️ App Store compliance | High | Yes | 🟡 Core flow verified in B121 (2026-04-18). Relational cascade gap (friendships / leaderboard / tutor shares still reference deleted users from OTHER users' perspectives) confirmed reproducible — tracked in BUGS.md as "Post-delete relational cascade." Fix = migration 0017 + optional farewell push. |
| 11 | Rebrand: Kanji Learn → Kanji Buddy | Med | No | **Next up.** Pending. |
| 9 | Splash Screen Polish: solid bg color, longer display duration, branding imagery | Med | No | Pending — bundle with #11 |
| 10 | About/Credits Page: add app branding imagery and credits | Low | No | Pending — bundle with #11 |
| 7 | Dark / Light Theme Toggle | High | No | Pending |
| 8 | Heatmap Calendar View | High | No | Pending |

**Why this order (reshuffled 2026-04-17 after OAuth fix + Delete Account ship):**
- **Rebrand (#11)** is the next launch-blocker work — natural "Kanji Buddy 1.0" v2 moment; should land together with the splash polish and about/credits page as a coordinated release.
- **Splash polish (#9) + About/Credits (#10)** — natural companions to the rebrand; share branding imagery and messaging.
- **Theme toggle (#7)** — highly requested UX polish; touches every screen, better before adding more screens.
- **Heatmap (#8)** — retention/motivation feature, purely frontend.

**Prior context:**
- #5 was originally marked ✅ Done on 2026-04-13 after TestFlight B111 verification, then suspected to have regressed in B116. Root cause was actually the new onboarding routing gate exposing a pre-existing `useProfile` race + a missing `on_auth_user_created` Postgres trigger; OAuth itself never broke. Re-verified clean after B117/B118.
- #6 shipped via the onboarding branch, merged into tutor-analytics-sharing, landed on main via PR #6 on 2026-04-17.
- #12 design spec at `docs/superpowers/specs/2026-04-17-delete-account-design.md`; implementation plan at `docs/superpowers/plans/2026-04-17-delete-account.md`. Initial cascade gap on `learner_identity` (no FK to `user_profiles`) caught in B120 code review and fixed via migration 0016. Second cascade gap (relational tables referencing the deleted user from other users' viewpoints) surfaced in B121 verification and is pending migration 0017 — see BUGS.md.

**2026-04-18 session (B121):** Two bundled builds merged and shipped in a single TestFlight cut — see `docs/superpowers/plans/2026-04-18-b121-copy-and-ux-sweep.md` and `docs/superpowers/plans/2026-04-18-b122-study-loop-and-leaderboard.md`. No explicit Phase 2 items were closed, but a substantial refinement bundle shipped: accuracy→confidence terminology audit, Dashboard auto-refresh, Take Quiz empty state, JLPT color legend, weighted 3/2/1/0 confidence scoring (API + client, fully verified via controlled DB test), mnemonic trigger narrowed to Again only, "Show mnemonic" button on Kanji details page, meaning/reading visual cue on study cards, dismissible invite-a-mate banner, leaderboard days-studied + remembered columns, onboarding motivational footer. 12 of 14 verification items passed; 4 new bugs logged (three still open: stale Session Complete state, daily goal hardcoded to 20, post-delete relational cascade confirmed); 3 new refinements logged (gesture mapping clarity, Session Complete breakdown, speak on sentences).

**Late-evening same-day follow-up — 45s save-session latency fixed:** Root cause was the submit path running one transaction per review (~7 cross-region DB round-trips × 20 cards = ~145 RTTs). Shipped batched submit (commit `d137b9c`, App Runner deploy op `c8b9b0b466a7471b8c69f2f24befcd27`): single transaction with four bulk statements, O(1) round-trips regardless of session size. Expected ~12× speedup (~45s → ~4s). 8 unit tests cover the pure batching transformation. On-device confirmation pending next study-session save.

---

## Phase 3 — Learning Engine (M effort, strengthens SRS core)
*Make the study loop smarter and give users deeper insight into their progress.*

| # | Enhancement | Impact | Backend | Status |
|---|------------|--------|---------|--------|
| 9 | Leech Detection & Review Mode | High | Yes | Pending |
| 10 | Cram Mode | Med | No | Pending |
| 11 | Grade Level Equivalent (Kyouiku Kanji) | Med | Yes | Pending |
| 12 | Retention Rate Over Time Graph | Med | No | Pending |

**Why grouped:**
- Leech detection first — highest-impact SRS improvement, informs the AI study plan later (Phase 6)
- Cram mode shares UI patterns with leech review (filtered study sessions without SRS updates)
- Grade level equivalent adds a new progress dimension; pairs naturally with the retention graph as "analytics round 2"

---

## Phase 4 — Advanced Study & Data (L effort)
*Deeper features for committed learners. Some require new data sources.*

| # | Enhancement | Impact | Backend | Status |
|---|------------|--------|---------|--------|
| 13 | Custom Study Session Builder | High | Yes | Pending |
| 14 | Adaptive Daily Goal | Med | Yes | Pending |
| 15 | Data Export (CSV / JSON) | Med | Yes | Pending |
| 16 | Pitch Accent Indicator | Med | Yes | Pending |
| 16b | Speaking: Vocab Words Instead of Single Kanji Readings | Med | Yes | Pending |

**Why grouped:**
- Custom session builder is the natural extension of leech mode + cram mode from Phase 3 — all three share "filtered study session" infrastructure
- Adaptive daily goal depends on having enough usage data and benefits from the analytics built in Phase 3
- Data export is independent but straightforward backend work, good to pair here
- Pitch accent requires sourcing and importing a new dataset (Wadoku or similar), so it's its own mini-project

---

## Phase 5 — Platform & Scale (M–L effort)
*Infrastructure and multi-device reach. Do before user count demands it.*

| # | Enhancement | Impact | Backend | Status |
|---|------------|--------|---------|--------|
| 17 | Backend Scaling (Analytics Cache) | High | Yes | Pending |
| 18 | Home Screen Widget (iOS/Android) | Med | No | Pending |
| 19 | iPad & Mac Catalyst Support | Med | No | Pending |

**Why grouped:**
- Backend scaling should happen before a major marketing push or App Store feature
- Home screen widget and iPad support are platform expansion features — both are native work (Expo widget plugin, responsive layouts) and benefit from a stable, scaled backend

---

## Phase 6 — Moonshots (XL effort)
*High-ambition features that fundamentally expand what the app can do. Each is a project unto itself.*

| # | Enhancement | Impact | Backend | Status |
|---|------------|--------|---------|--------|
| 20 | Multiple SRS Deck Support | High | Yes | Pending |
| 21 | Graded Reading Passage Mode | High | Yes | Pending |
| 22 | AI-Powered Personalized Study Plan | High | Yes | Pending |

**Why last:**
- Multiple decks is an architectural change (schema, SRS service, all UI) — highest risk
- Reading passages are a new product surface, not an improvement to an existing one
- AI study plan benefits from leech data (Phase 3) and session builder infrastructure (Phase 4)

---

## Known Bugs

Tracked in [BUGS.md](BUGS.md) — see that file for current open and recently-fixed issues. (This roadmap previously duplicated the list and drifted out of date; BUGS.md is now the single source of truth.)

---

## Deprioritized
*Not forgotten — revisit when demand justifies the effort.*

| # | Enhancement | Impact | Notes |
|---|------------|--------|-------|
| D1 | Webhook / Zapier Integration | Low | Power-user niche. Build when requested by paying users. |
| D2 | OCR Kanji Lookup | High | XL effort. Requires on-device or cloud OCR model + camera permissions. Revisit when core features are mature. |

---

## Summary

| Phase | Items | Effort Range | Theme |
|-------|-------|-------------|-------|
| **0** | **2** | **M** | **🚨 Security — RLS & sensitive data** |
| 1 | 4 | S | Polish & consistency |
| 2 | 8 | M | Onboarding & daily UX |
| 3 | 4 | M | Smarter SRS & analytics |
| 4 | 5 | M–L | Advanced study & data |
| 5 | 3 | M–L | Scale & multi-device |
| 6 | 3 | XL | Transformative features |
| D | 2 | M–XL | Deprioritized |
| **Total** | **31** | | |
