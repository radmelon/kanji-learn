# B145 — device test plan

**Canonical URL — hand this to a new session:**
https://github.com/radmelon/kanji-learn/blob/main/docs/b145-test-plan.md

Built from live account state on 2026-07-28 13:45 PDT. Buddy has **280 due**,
104 learning, and six co-created hooks.

---

## Two constraints — read before starting

### 1. The reinforce path is time-locked until 18:04 PDT tonight

The freshness guard shipped today requires a hook to be **24 hours old** before
it can be reinforce-challenged. Every existing hook was built within the last
24 hours, so **the reinforce branch cannot fire right now at all**.

| Hook | Built (PDT) | Reinforce-eligible | Story length |
|---|---|---|---|
| 値 | 07-27 18:04 | **07-28 18:04** ← first | 303 |
| 互 | 07-27 19:45 | 07-28 19:45 | 387 |
| 両 | 07-27 20:14 | 07-28 20:14 | 258 |
| 暗 | 07-28 07:45 | 07-29 07:45 | **510** ← longest |
| 調 | 07-28 08:29 | 07-29 08:29 | 458 |
| 費 | 07-28 09:18 | 07-29 09:18 | 218 |

**Consequence: B-219 and B-220 cannot be tested before 18:04**, because both
live in `ReinforceSheet` and nothing else opens it.

This is also its own test — see **G0** below. A reinforce offer appearing
*before* 18:04 would mean the guard does not work.

### 2. The sheet-clipping fixes need an iPhone, not the iPad

`supportsTablet: true`, so B145 runs at native iPad resolution. B-215/B-220
were `maxHeight: '80%'` overflows — and 80% of an iPad screen is enormous, so
**the bug would not reproduce on iPad even on the broken build**. Passing on
iPad proves nothing about them.

Everything else in this plan is iPad-valid.

---

## A — Build one hook (iPad, now)

Covers **B-217**, **B-218**, **B-212**, and the rotated `ANTHROPIC_API_KEY`,
which resolved this morning but has never actually been called.

Browse → any kanji with two or more components → **Build a hook**. 説 (言 + 兑)
is the exact case that was reported.

- [ ] **B-217** — the teaching beat reads *"説 is 言 (speech) beside 兑."*
      The literal words **"this part"** must not appear anywhere. This affected
      99% of kanji, so any multi-component kanji will do.
- [ ] **ANTHROPIC_API_KEY** — the draft is woven prose that uses your anchor,
      not a mechanical template. Template-sounding output means the cloud tier
      failed and it fell through. **This is the only real test of the rotated
      key** — until it passes, do not revoke the old keys.
- [ ] **B-212** — tap **Speak it**. The Japanese in the story must be
      *pronounced*, not skipped. Previously the whole story was read with an
      en-US voice, which silently dropped every kanji and kana.
- [ ] **B-218** — after saving, there is **no** "Quick check — which kanji does
      this hook belong to?" screen. That dead end is deleted.
- [ ] Scroll the commitment page. On iPad it will fit regardless — just confirm
      nothing looks obviously wrong.

## B — Journal (iPad, now)

Covers **B-211** and **B-213**.

- [ ] **B-211** — the Journal tab opens on a list of **all six hooks, newest
      first**, each with its kanji, meanings and layer count. Before this build
      it showed "Search a kanji" and could not list anything.
- [ ] Search still works as a filter (type 暗).
- [ ] **B-213** — every card has **Speak it**. Previously it existed only at
      the moment of creation, never where a hook is read.

## C — The blocker (iPad, now)

Covers **B-216**. Two routes; both used to end in a force-quit.

**C1 — profile change mid-session (the identified trigger):**

1. Study tab → Begin, grade two or three cards.
2. Switch to Profile, toggle **Mnemonic coaching** off, then on.
3. Return to Study.

- [ ] Your session is still there. Previously this PATCH wiped the queue.
- [ ] If it *is* lost, you get **"Session interrupted"** with **Start a
      session** / **Back to Study** — never "All caught up!" with 280 due.

**C2 — the second reported route:**

1. Complete a full session.
2. At Session Complete, accept the offer to build a hook.

- [ ] Session Complete stays on screen. It used to vanish mid-flow, taking the
      only route back to the Ready screen with it.

**Either way, you must never need a force-quit.** That is the whole bug.

## D — Recall quiz (iPad, now)

暗, 互 and 値 are all overdue and carry hooks, so one will lead a session.

- [ ] The story→kanji recall quiz runs **before** the flashcard.
- [ ] **New behaviour:** after answering, the session moves to the **next
      kanji** — that kanji's own flashcard is skipped. Previously you were shown
      its flashcard seconds later, primed by the quiz you had just answered.
- [ ] The kanji stays due (no grade is recorded). I will confirm server-side.

## E, F — Untested since B144 (iPad, now)

- [ ] **Hint button** — on a flashcard, tap Hint. The hook is shown, and the
      grade is capped at **Hard**. Try swiping right for Easy; it must still
      cap. (The cap is enforced in `handleGrade`, not just the buttons, because
      swipe-to-grade never touches them.)
- [ ] **"Not now" cooldown** — decline a Buddy moment; it must not reappear for
      that kanji next session.
- [ ] **Coaching toggle** — with it off, no automatic Buddy moment appears at
      Session Complete, but **Build a hook** still works manually.

## G — After 18:04 PDT (iPad)

Covers **B-219** and the freshness guard.

- [ ] **G0 (now, before 18:04)** — grade a hooked kanji **Again**. **No**
      reinforce offer should appear. One appearing means the guard is broken.
- [ ] **G1 (after 18:04)** — study 値, grade it **Again**, finish the session.
      The reinforce sheet should now appear.
- [ ] **B-219** — tap **Reveal the reading**. It must show the actual On/Kun
      readings. Before this build the button advanced the flow and revealed
      nothing at all — half of the two-step recall had never worked.

## H — iPhone only

Neither is meaningfully testable on iPad.

- [ ] **B-215** — open 暗's hook (**510 characters**, the longest and the exact
      case that surfaced this). The commitment page must scroll to the end,
      with a visible scroll indicator.
- [ ] **B-220** — take the reinforce flow to its final step. The footer button
      must be fully visible with its label, and the content above it scrollable.
- [ ] **B-216 recovery screen** — if you can trigger it, both buttons fit and
      the screen scrolls on a short device.

---

## What I verify server-side afterwards

- **D** — that the recall-quizzed kanji has **no** new `review_logs` row and an
  unchanged `next_review_at`. That is what "not reviewed today" has to mean.
- **G1** — `reinforcement_count` incremented and `effectiveness_score` moved.
- **A** — a new `mnemonics` row with `generation_method='cocreated'`, and
  whether the assembler reached the cloud tier.
- **B-222** — streak copy in the next daily push (fires 08:00 PDT).

## Still open, and not fixed in B145

- **B-212(b)** — whether TTS *quality* improves with Enhanced voices installed.
  An OS-asset question; only your ears can answer it.
- **B-210** — retaking the placement test destroys FSRS state. Do **not** tap
  Placement Test on the Profile page while testing.
- **The §9 question** — whether the hook appears on the flashcard's **prompt**
  face or only after reveal. Code says answer-side only. If you ever see a hook
  *before* revealing, stop and report it: that is a retrieval-protection
  violation and outranks everything in this plan.
