# B131 testing — three API bugs landed

**Session:** 2026-04-24 (evening). End of B131 TestFlight testing on
iPhone (`buddydennis@gmail.com`) + iPad mini (`buddydennis@me.com`,
fresh student account created for the notifications/study-mate test
strategy).

**Outcome:** three API-only fixes committed to `main` against the
live DB schema unchanged. **No new build cut tonight.** Will re-test
on existing B131 client against deployed API in a fresh session
tomorrow.

---

## Bug 1 — Speaking screen empty for fresh accounts

**Symptom (iPad mini, new student):** completed two 5-card Study
sessions, Speaking tab shows "Nothing to practice yet — complete some
flashcard reviews first."

**Root cause:** `srs.service.ts#getReadingQueue` scope-to-ids path
INNER JOINed `userKanjiProgress`. Today's Study deck on a low-progress
account is dominated by new unseen cards which have no progress row
yet — the inner join filtered them all out, returning 0 rows.

**Fix:** scope-to-ids path now drives off `kanji` and LEFT JOINs
`userKanjiProgress`, defaulting `status='unseen'` / `repetitions=0`
when the row is absent. Default (no-kanjiIds) path unchanged.

**Commit:** `3ff0a21 fix(api): include new unseen kanji in scoped Speaking queue`

---

## Bug 2 — Self-notify on study-mate fan-out (defensive only)

**Symptom (iPad mini, new student):** in-app banner reading
"<own-RAD-username> just studied — keep pace?" — i.e. the user got a
mate alert about their own activity.

**Investigation note:** the initial hypothesis was a self-loop
friendship row (`requesterId === addresseeId`), but a
`SELECT … WHERE requester_id = addressee_id` on the live DB returned
0 rows. Real cause was Bug 3 below (stale push token). The two
self-defences in this commit still make sense as belt-and-braces.

**Fix (two layers):**

- `social.service.ts#sendRequest`: reject self-invite at request
  creation.
- `notification.service.ts#notifyStudyMates`: defensive
  `if (friend.id === submitterId) continue` in the fan-out loop.

**Commit:** `d3eba2c fix(api): block self-friending and guard study-mate fan-out against self`

---

## Bug 3 — Cross-account push delivery via stale token

**Symptom:** the new student account on iPad mini got a study-mate
alert addressed to the gmail account (the intended recipient on the
iPhone got nothing).

**Root cause:** `user_push_tokens` is keyed `(user_id, token)`. The
iPad was previously signed in as `@gmail.com`, then signed out and
re-registered as `@me.com`. The mobile-side logout DELETE is
best-effort and either failed or the token re-registered before
DELETE landed. Result: same Expo token registered to both userIds.
When `@me.com` studied, fan-out targeted `@gmail.com`, found a row
pointing at the iPad, and delivered there.

Confirmed on live DB:
```sql
SELECT token, COUNT(*) FROM user_push_tokens
GROUP BY token HAVING COUNT(*) > 1;
```
returned 1 offending row (count = 2).

**Fix:** on `POST /v1/push-tokens`, server now deletes
`WHERE token = $1 AND user_id != currentUserId` before the upsert.
Registration is a "reclaim" — the device's token belongs to whoever
is currently signed in. Self-heals on next app foreground after
deploy.

**Commit:** `9a3ac1e fix(api): reclaim push token from prior user on registration`

---

## Deploy + re-test plan (next session)

1. Deploy API to staging, then production (no schema changes).
2. Re-test on existing B131 build:
   - iPad mini (still B131): foreground the app → expect token to
     migrate to `@me.com`. Verify with the dup-token query (should
     return 0 rows).
   - Have `@me.com` study a deck → expect push on iPhone (`@gmail.com`),
     not on iPad. Expect Speaking tab on iPad to populate with the 5
     studied kanji.
3. If green, fold any further B131 findings into B132 alongside the
   three items in `project_next_session_b132_plan.md`.

## Out of scope tonight

- B132 plan items (study-mate invite surfacing, tutor-share Resend
  URL, Watch `print()`→`os_log`).
- Schema-level `CHECK (requester_id != addressee_id)` constraint on
  `friendships` — application-level guard is sufficient given the
  defensive `continue` in fan-out. Revisit if we ever see another
  self-loop slip through.
- Mobile-side push handler self-filter on `data.friendId ===
  currentUserId` — would be a defence-in-depth; not needed once the
  server reclaim fix is deployed.
