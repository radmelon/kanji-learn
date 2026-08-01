# B147 — device test plan

> **Canonical URL — hand this to a new session:**
> https://github.com/radmelon/kanji-learn/blob/main/docs/b147-test-plan.md

**Build:** 147 · `0eb38925-1e58-41ef-8b0f-b37eed274a06` · content commit `c32ac7c`
(bump recorded as `ebbdd35`)
**Cut:** 2026-08-01 14:21:40, finished 14:28:08, auto-submitted
**API on live:** deployed 2026-08-01 14:11:17, image `sha256:c55b2f64…`

B147 is the widest build in this project's history. B146 predated **both** Phase 6
and Phase 7, so two phases of mobile work reach a device for the first time here —
on top of the two B146 walkthroughs that were never run. Four walkthroughs, one
build.

---

## 0. Preconditions — read before starting

- [ ] **Use an `America/Los_Angeles` account.** `runBuddyDayPass` deliberately
      **skips** rows still on the `'UTC'` default rather than guessing at a local
      day. On a UTC account a working guard is indistinguishable from a broken
      feature.
- [ ] Confirm the build is 147 — Profile → About, or TestFlight's build number.
- [ ] **Expect to be walked through Meet Buddy on first launch. This is not a
      bug.** The onboarding gate moved from `onboardingCompletedAt` to
      `metBuddyAt`, and migration `0033` stamped **0 rows** — by design (spec
      decision #7). Every existing learner, including you, meets Buddy once.
- [ ] Old-build interaction is safe: `/complete` stamps `onboarding_completed_at`
      too, so a conversation-onboarded account opening B146 is not re-gated.

### 🛑 One check here needs an API deploy that has NOT happened

`504b1ea` (placement level bands) is committed to `main` and **is not in the live
image** — the running API was deployed at 14:11, before it landed. §4b is
unverifiable until the API is redeployed. Everything else in this plan runs
against the deployed API as-is.

---

## 1. The three issues reported from B146

Verify these first — they are the reason this build exists in the shape it does.

### 1a. The Buddy session screen rendered black *(fixed in this build)*

Root cause was not a dead end: `BuddySessionBody` had no styling at all, React
Native defaults `<Text>` to black, and `colors.bg` is `#0F0F1A`. The screen
rendered *correctly* and was entirely invisible — and inescapable, because the
route sets `headerShown: false`. Seven component tests passed throughout, because
`getByText` finds text whatever colour it is.

- [ ] Profile → **Meet Buddy / Buddy session** row → the screen shows a header
      reading **"Buddy"**, a close **✕**, and body text — all legible
- [ ] The ✕ dismisses to somewhere sensible (tabs, if there is no back stack)
- [ ] Colour check: text is light-on-dark, not "present but invisible" — tilt the
      screen brightness up if unsure

### 1b. "0 kanji recognized" *(fixed and already live — `2cab737`)*

Seeding used to iterate only the ~10 asked kanji. Item selection maximises Fisher
information (peaks at `b ≈ theta`) while seeding requires `p(knows) ≥ 0.85`
(`b ≤ theta − 1.386`). **Disjoint sets — no learner at any ability could ever seed
anything.** Seeding now runs over the whole corpus.

- [ ] Complete a placement test → the result reports a **non-zero** recognized
      count
- [ ] That count is modest (single digits to low tens), not 44 and not 0

> This fix does **not** repair the row your earlier run wrote. It applies to new
> completions.

> **Resolved on B147, 2026-08-01.** The screen renders and its text is legible —
> confirmed on device by reading "Next catch-up: 2026-08-08" off it. B146 shipped
> the unstyled version (`1817efb` is *not* an ancestor of B146's `1a4aaf3`), which
> is why that build showed nothing at all.
>
> **What remains is not a rendering bug — it is the `waiting` state having nothing
> on it.** See §1d.

### 1d. 🔴 NEW — the weekly session has no completion confirmation

Found 2026-08-01 on B147, by walking the real flow:

1. The invitation push fired (on a *different device* — see §1c)
2. Tapping it opened the session: an opener, then a card reading **"The week ahead
   / 4 days, 15 minutes"** with a button labelled **"That works"**
3. Tapping "That works" posts the commitment with `source: 'session'`
4. The screen reloads → `getMostRecentAgreed` now returns this week's row →
   `evaluateAppointment` correctly returns `waiting` → the screen becomes a dark
   near-empty page showing only `Next catch-up: 2026-08-08`

**Every step of that is working as designed.** The session was held, the commitment
was recorded, and the next appointment is a week out. But the learner is given no
acknowledgement that anything happened — no "you're set for 4 days, 15 minutes" —
and the screen they land on is indistinguishable from the B146 breakage they were
just looking at. Forcing a session from Profile afterwards shows the same page,
also correctly.

- [ ] Confirm the sequence above reproduces
- [ ] Confirm the header (**"Buddy"** title and a **✕**) IS visible on that page —
      `headerTitle` uses `colors.textPrimary` (`#F0F0F5`) and should be near-white.
      If the ✕ is missing, that is a second defect and the page is once again
      inescapable

**Design question this raises, not yet decided:** what should Profile → Buddy
session show between appointments? A dead end is the current answer. Showing the
commitment in force, with a way to adjust it, is the obvious alternative.

### 1c. No notification arrived — RESOLVED, it did fire

**Outcome: the push fired correctly. It arrived on the iPhone while testing was
happening on the iPad mini** — so the device under test was silent and the feature
looked dead. `sendToUserTokens` fans out to every registered token on the account,
so a device that receives nothing has **no token registered** (or notification
permission was never granted there), not a broken pass.

- [ ] On the device you are actually testing on, Profile shows a **registered push
      token** — if it offers a "Fix" action, that device will never receive
      anything
- [ ] Grant iOS notification permission on that device (Settings → KanjiBuddy)

The delivery chain was verified healthy end-to-end on 2026-08-01: EventBridge
`kanji-learn-hourly-reminders` **ENABLED** `cron(0 * * * ? *)` → Lambda invoking
hourly, no errors → `POST /internal/daily-reminders` returning `200 {"ok":true}`
at 19:00, 20:00 and 21:00 → pushes **accepted** by Expo for other accounts, **zero
receipt errors**. (`delivered=0` in those logs is documented-normal: receipts are
asynchronous and polled immediately, so they are never ready yet.)

So the machinery works and the remaining variables are all on your account row:

- [ ] Profile shows a **registered push token**. If it shows the "Fix" action,
      that alone explains the silence — at least one live account has **no
      registered push token at all**
- [ ] iOS notification permission is granted for KanjiBuddy (Settings → KanjiBuddy)
- [ ] Timezone is **not** `'UTC'` (see §0)
- [ ] `buddy_day` is set
- [ ] **`reminder_hour` matters exactly.** The invitation only fires when the
      learner's local hour *equals* `reminder_hour` (default 20:00) — not "after"
- [ ] `notifications_enabled` is on

Then force one:

- [ ] Set **Buddy day = today**, **reminder hour = the next whole hour**, wait for
      `:00`
- [ ] **Expect possibly two notifications.** `sendDailyReminders` fires on the same
      hour. The Buddy one carries a `buddy_session` payload and opens the session
      screen; the daily study nudge does not. Don't read the nudge as the Buddy push

---

## 2. Meeting Buddy — Phase 7, never on a device

The headline flow. Onboarding is now a conversation, with a template floor that
must work with no network at all.

### 2a. The template floor, offline end-to-end

This is the scenario the floor exists for, and it is the one that was broken
until the fix wave.

- [ ] **Airplane mode on**, fresh account → the meeting still runs and can
      **complete** (interests must be reachable on the template tier — that was
      HIGH defect #1)
- [ ] Finish offline → relaunch the app → the stash **flushes**
- [ ] Page one appears in the Journal afterwards
- [ ] Paste an **over-long** message (>1000 chars) at the free-text prompt → it is
      clamped, not rejected. An unclamped field used to make the stash permanently
      400 and lock that device out of onboarding entirely

### 2b. The cloud conversation, with a real LLM

- [ ] Network on, fresh account → Buddy's replies are generated, not templated
- [ ] Buddy introduces **himself** on page one (spec §6)
- [ ] A **free-text reply at the ask beat** reaches a real `done` surface with a
      finish CTA — it used to dead-end, and typing again 400'd into a template flip
      that removed the composer
- [ ] The finish CTA **disables after the first press** (no double-submit)
- [ ] Placement can be entered from the ask beat

### 2c. Re-entry and escape hatches

- [ ] Profile → **Meet Buddy** row → actually opens the meeting. It was 100% inert
      for everyone who could see it (`begin()` bailed `'already_done'`)
- [ ] **Skip to form** → the old stepper at `/onboarding-form` still works
- [ ] Complete via the form → `onboarding_completed_at` **and** `met_buddy_at` are
      both stamped, and you are not re-gated on next launch

---

## 3. The notebook — Phase 6, never on a device

- [ ] Journal / notebook screens render with content, not a blank cold load
- [ ] Entries created during onboarding are present (four page-one entries:
      `onboarding_intro`, `first_open`, `onboarding_appointment`,
      `onboarding_reasons`)
- [ ] Tutor notes render, and the language/translation fields do not crash a note
      that lacks them

---

## 4. Placement

### 4a. Against the deployed API — runnable now

- [ ] Test runs end to end without error
- [ ] **Stops at roughly 13 items, not 60**
- [ ] Seeds a **non-zero**, modest number of kanji (see §1b)
- [ ] Difficulty feels adaptive — a run of correct answers gets harder
- [ ] Retest starts from the stored posterior rather than from scratch, and is
      shorter

### 4b. The reported level — 🛑 BLOCKED until the API is redeployed

`504b1ea` fixes level bands being computed from the learner's own ~10 asked items
and then labelled out of the full five-level list. The bug is **inverted**: item
selection asks near your ability, so a strong learner is never asked an N5 item,
those levels drop out of the ladder, and the index-1 band — really N2 — was
reported as **N4**. The better you did, the lower the level you were told.

Once the API carries `504b1ea`:

- [ ] Answer most items correctly → the reported level is **N3 or higher**, and
      moves *up* with performance
- [ ] Answer most items incorrectly → the level moves *down*. The direction is the
      test; the exact band is not
- [ ] The level no longer contradicts the recognized count

---

## 5. Known gaps — recorded, not hidden

Do not report these as new:

- Offline **revisit** demotes to a blank first-run walk
- The pending-offline screen says "offline" for **any** flush failure, not just
  network
- An LLM reply >1000 chars 400s the next `/turn` and silently flips to template
- The tier-2 daily cap has not been sized against ~a-dozen-turns-per-onboarding
- Cadence step-down needs three consecutively missed periods — not exercisable in
  one walkthrough. What you *can* check: over 2–3 days, the invitation does **not**
  re-push daily while a session stays unattended

---

## 6. If something fails

Capture, in this order:

1. What you tapped and what happened, including app state (killed / background /
   foreground) and **network state** — half of Phase 7's failure modes are
   offline-only
2. Your account's `buddy_day`, `reminder_hour`, timezone, and push-token status
3. The exact time, with zone — almost everything here is timezone-conditional
4. Whether the API returned an error or the screen simply showed nothing.
   **Silence and failure look identical in this feature**, which is why §0's
   timezone precondition exists

Server-side issues can be fixed and redeployed the same day. **A mobile fix needs a
new build plus Apple processing**, so anything found here is worth reporting before
the next build is cut rather than after. The EAS allowance renews **2026-08-04**.
