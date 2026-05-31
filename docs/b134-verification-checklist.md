# B134 Verification Checklist

Source: [HANDOFF.md](HANDOFF.md) (2026-05-21). Covers Plans A + B + C combined plus B133 carry-over items.

## Pre-flight

- [ ] B134 appears in TestFlight and installs (Apple processing must be done)
- [ ] Prod API rollout completed — quick check: hit `https://73x3fcaaze.us-east-1.awsapprunner.com/v1/tests/question` (any auth'd call) and confirm it doesn't 404
- [ ] App opens, you're signed in, you have at least one account with due reviews

## Plan A — minutes-budget time-box

- [ ] Onboarding (new account) asks **"How many minutes per day?"** with options 5 / 10 / 15 / 20 / 30, default **15**
- [ ] Profile screen shows **"Minutes per day"** (not "cards per day")
- [ ] Study session shows a live **"Nm left"** countdown in the header
- [ ] Session **does not** cut off mid-card — it ends after the in-progress card completes
- [ ] 🎉 banner appears when the minutes goal is met
- [ ] **"Keep studying"** starts a fresh timed segment
- [ ] Dashboard shows **"N reviewed today"** as a plain count (no "X / Y" cards-vs-goal fraction)

## Plan B — writing/speaking legs + nav

- [ ] Tab bar shows **exactly 6 tabs**: Dashboard · Study · **Browse** · Journal · Progress · Profile
- [ ] **No Write tab, no Speak tab**
- [ ] Grading a **new** kanji → writing leg → "Continue to speaking" button → speaking leg → advances to next card
- [ ] Grading a review kanji **Again** or **Hard** → routes through writing → speaking
- [ ] Time-remaining indicator visible on **leg headers** (writing/speaking)
- [ ] Session **never ends mid-leg** — only after a kanji's full path completes
- [ ] **"Drill Weak Spots"** / **"Drill missed cards"** stay flashcard-only (no writing/speaking)
- [ ] On a heavy-review account, the session surfaces some **new kanji near the start** (guaranteed allowance)

## Plan C — quiz leg + Ready screen + vocab speaking + breakdown

- [ ] Opening the Study tab shows the **Ready screen** first: today's minutes + due count + Begin button (not the old auto-start)
- [ ] Grade a **Good/Easy** review kanji that's "maybe slipping" (recent Hard/Again, or a burned-sample card) → a **quiz question** appears
  - [ ] **Pass the quiz** → advances normally
  - [ ] **Fail the quiz** → routes to writing → speaking; card should resurface sooner on a later session (note the kanji and check next session)
- [ ] Grade an **unflagged** Good/Easy → advances straight on, **no quiz**
- [ ] **Speaking leg** for a kanji with example vocab → vocab-word layout (vocab text + pitch reading), not the legacy kanji-reading layout
- [ ] **Speaking leg** for a kanji without example vocab → legacy kanji-reading layout
- [ ] **Session Complete** screen shows the **"Practice breakdown"** row with rep counts for flashcard / writing / speaking / quiz

## Plan C — API-side spot checks

- [ ] After completing a loop quiz, a `testSessions` row exists with `test_type = 'loop_check'` and matching `testResults` (Supabase SQL check)

## B133 carry-over — still owed

- [ ] App Runner logs show **one** `[Internal] Daily reminder job triggered` per hour
- [ ] App Runner logs show **no** `[Cron] Running hourly reminder check` (the old path should be gone)
- [ ] **One** daily-reminder push per day, no duplicate (this was the B133 carry-over bug)
- [ ] Study **speaker icon un-sticks** (Item 6)
- [ ] **Empty-transcript hint** appears on Speaking when nothing is recognized (Item 7)
- [ ] Previously reported **Speak vocab words** now pass recognition (Bug A)

## Quick-fail signals (worth a screenshot if seen)

- Mid-card session cut-off
- Quiz appearing on unflagged Good/Easy cards
- Speaking leg showing kanji-reading layout when example vocab exists
- Duplicate daily-reminder push
- Tab bar showing Write or Speak tabs
- Crash / red-screen on the Ready screen
