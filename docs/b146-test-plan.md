# B146 — device test plan

**Build:** 146 · `c3cd48d6-59ac-43ef-880c-f1ddc503b26c` · commit `1a4aaf3`
**Submitted:** 2026-07-31 13:49
**API:** deployed 2026-07-31 13:29, image `sha256:efce8a74…`, verified by content

B146 carries **two** slices that have never run on a device: the placement model
and the weekly Buddy review. Both device walkthroughs are discharged here.

---

## 0. Preconditions — read before starting

- [ ] **Use an `America/Los_Angeles` account.** `runBuddyDayPass` deliberately
      **skips** rows still on the `'UTC'` default rather than guessing at a local
      day. Testing on a UTC account shows silence, and a working guard reads as a
      broken feature. Live spread: LA 2, UTC 2, Tokyo 1.
- [ ] Confirm the build is 146 — Profile → About, or TestFlight's build number.
- [ ] **Anyone still on B145 has broken placement.** `POST /v1/placement/complete`
      now takes `responses: [{kanjiId, itemType, correct}]`; B145 sends
      `results: [{kanjiId, passed}]`. Expected, not a regression. Update testers.

---

## 1. Getting the push to fire today, not next week

The hourly pass is `kanji-learn-hourly-reminders`, `cron(0 * * * ? *)`, **enabled**
— it runs at the top of every hour. No manual trigger and no internal secret
needed.

- [ ] Profile → set **Buddy day = today**
- [ ] Profile → set **reminder hour = the next whole hour**
- [ ] Wait for :00

**Expect possibly two notifications.** `sendDailyReminders` also fires on
`reminder_hour`, so the daily study nudge and the Buddy invitation can arrive
together. The Buddy one carries a `buddy_session` payload and opens the session
screen; the daily one does not. Don't read the study nudge as the Buddy push.

---

## 2. Notification routing — the deliberate test gap

**This is the most important section.** There is no test harness in the repo for
mounting `_layout.tsx` or mocking `expo-notifications`' response surface, so a
shallow mock would only test the mock. This section is the only proof that
exists. The handler and the route were both missing entirely until `09fb7c9`.

- [ ] **Killed app** — force-quit, then tap the Buddy push → lands on the session
      screen
- [ ] **Backgrounded app** — home button (not force-quit), tap the push → lands on
      the session screen
- [ ] **Foreground, screen already open** — tap the push while the session screen
      is showing → **no double-navigation**, no stacked screens, back button
      behaves
- [ ] **No push at all** — Profile → Buddy entry point → reaches the same screen
- [ ] Back out of the session screen and confirm you land somewhere sensible

---

## 3. The weekly session

- [ ] Session screen shows a **state** — `due`, `waiting`, or `not_scheduled` —
      and not an error or an endless spinner
- [ ] Buddy's opener reads correctly for a first session (there is no prior
      commitment, so the reckoning should be absent, not a report on zero)
- [ ] Set a commitment: days and minutes
- [ ] **Kill the app and reopen** → the commitment persisted
- [ ] Reopen the session screen the same day → it does **not** offer to set a
      second commitment for the same period
- [ ] Set `buddy_day` to a *different* day → screen reports `waiting` with a
      sensible next-due date

> **This closes a verification I could not complete.** Deploy verification
> confirmed `GET /v1/buddy/session` returns 401 rather than 404, proving the route
> shipped, but proving the *body* contains `state` needs a real signed-in token.
> Seeing this screen render is that proof.

**Not testable this week, and worth knowing:** the cadence step-down needs three
consecutively missed periods, so it cannot be exercised in a walkthrough. The
`0031` migration (`buddy_cadence_changed_at`, `buddy_last_invited_at`) exists
specifically to stop it firing twice in one hour and to stop the invitation
re-pushing every day of its window. What you *can* check is the second half:

- [ ] Over the next 2–3 days, confirm the invitation does **not** re-push daily
      while a session stays unattended

---

## 4. Placement — the adaptive test

Run from a **fresh account**, since placement is an onboarding-time flow.

- [ ] Test runs end to end without error
- [ ] **It stops at roughly 13 items, not 60.** The old staircase asked ~60
- [ ] **It seeds roughly 2 kanji, not 44.** Conservative seeding at p ≥ 0.85
- [ ] Item difficulty feels adaptive — a run of correct answers should get harder
- [ ] Retest: run placement a second time; it should start from the stored
      posterior rather than from scratch, and be shorter

> **Why the two numbers matter more than usual.** `kanji_difficulty` was
> recomputed on 2026-07-31 after a scale bug that put `b` on the FSRS 1–10 scale
> instead of the logit scale — only 285 of 2294 kanji were inside the θ grid and
> seeding was effectively impossible. This is the **first run against corrected
> data**, so ~13 and ~2 are finally meaningful predictions rather than hopes. A
> test that asks far too few items, or seeds zero, is the signal that something is
> still wrong with the difficulty table — not with the test logic.

---

## 5. If something fails

Capture, in this order:

1. What you tapped and what happened, including app state (killed / background /
   foreground)
2. Your account's `buddy_day`, `reminder_hour`, and timezone from Profile
3. The exact time, with zone — almost everything here is timezone-conditional
4. Whether the API returned an error or the screen simply showed nothing.
   **Silence and failure look identical in this feature**, which is why §0's
   timezone precondition exists

Server-side issues can be fixed and redeployed the same day. **A mobile fix needs
a new build plus Apple processing**, so anything found here is worth reporting
before the next build is cut rather than after.
