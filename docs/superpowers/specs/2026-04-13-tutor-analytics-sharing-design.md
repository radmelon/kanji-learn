# Tutor Analytics Sharing — Design Specification

**Date:** 2026-04-13
**Status:** Draft

## Context

A Kanji Buddy student wants to share their learning analytics with a human tutor who can leverage performance data to guide instruction. This feature adds a sharing mechanism to the Profile screen, an email-based invite flow, and a server-rendered HTML report that gives the teacher a detailed, bookmarkable view of the student's progress, effort, and AI-assisted analysis. The design anticipates future expansion to support Japanese language schools with private and group lessons.

## Decisions

| Decision | Choice |
|----------|--------|
| Deployment | Extend existing Fastify API (serve HTML report pages directly) |
| Access model | Persistent link with long-lived revocable token (90 days, auto-renewing) |
| Email service | AWS SES (same AWS ecosystem as App Runner and Lambda) |
| AI analysis | Hybrid — pre-computed daily via cron, with on-demand refresh button |
| Teacher input | Basic timestamped notes (visible to student in-app) |
| Report rendering | Server-rendered HTML with templating engine (Handlebars or ETA) + Chart.js via CDN |
| Terms of use | Placeholder flow — acceptance UI built, legal text supplied before launch |
| "Remembered" definition | Correctly recalled last 5 consecutive times over a span of ≥ 14 days |

## Data Model

### New Tables

#### `tutor_shares`

Tracks each student-teacher sharing relationship.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid (PK) | |
| userId | uuid (FK → user_profiles) | The student |
| teacherEmail | text | Teacher's email address |
| token | text (unique, indexed) | 64-char crypto-random URL token |
| status | enum: `pending` / `accepted` / `declined` / `revoked` / `expired` | Lifecycle state |
| termsAcceptedAt | timestamp (nullable) | When teacher accepted ToU |
| declinedAt | timestamp (nullable) | When teacher declined ToU |
| createdAt | timestamp | When invite was sent |
| expiresAt | timestamp | Token expiry (90 days, renewed on each visit) |
| revokedAt | timestamp (nullable) | When student revoked access |

#### `tutor_notes`

Teacher's notes visible to student in-app.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid (PK) | |
| shareId | uuid (FK → tutor_shares) | Links to the sharing relationship |
| noteText | text | The teacher's note |
| createdAt | timestamp | When the note was written |

#### `tutor_analysis_cache`

Pre-computed daily AI analysis for active shares.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid (PK) | |
| userId | uuid (FK → user_profiles) | The student being analyzed |
| analysisJson | jsonb | Structured AI analysis (see AI Analysis Structure section) |
| generatedAt | timestamp | When this analysis was computed |

#### `placement_sessions`

Each placement test attempt (enables retake tracking and trajectory analysis).

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid (PK) | |
| userId | uuid (FK → user_profiles) | |
| startedAt | timestamp | |
| completedAt | timestamp | |
| inferredLevel | text (N5–N1) | The level the student placed at |
| summaryJson | jsonb | `{ passedByLevel: { N5: 8, N4: 5, N3: 2 }, totalByLevel: { N5: 10, N4: 10, N3: 5 } }` |

#### `placement_results`

Individual kanji results per placement session.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid (PK) | |
| sessionId | uuid (FK → placement_sessions) | |
| kanjiId | integer (FK → kanji) | |
| jlptLevel | text | JLPT level of this kanji |
| passed | boolean | |

## System Flow

### Student Enables Sharing

1. Student opens Profile → "Share with Tutor" section
2. Student enters teacher's email → taps "Send Invite"
3. API creates `tutor_shares` row (status: `pending`), generates crypto token, sends invite email via AWS SES
4. Student sees share status: "Pending — invite sent to teacher@example.com"

### Teacher Accepts & Views Report

5. Teacher receives email: "Your student [name] has invited you to view their learning progress"
6. Teacher clicks link → `GET /report/:token` → Terms of Use page
7. Teacher accepts Terms → `POST /report/:token/accept` → status becomes `accepted`, `termsAcceptedAt` set
8. Redirects to full analytics report page — all sections rendered

If the teacher declines:
- Teacher clicks "Decline" → `POST /report/:token/decline` → status becomes `declined`, `declinedAt` set
- Teacher sees: "You've declined. If you change your mind, ask your student to send a new invite."
- Student sees in-app: "Your teacher declined the invite" with option to re-send a new invite
- Token is permanently invalidated

### Ongoing & Revocation

9. Daily cron pre-computes AI analysis for all active shares → `tutor_analysis_cache`
10. Teacher bookmarks report URL → returns anytime for fresh data (charts always live, AI analysis cached + refreshable)
11. Teacher leaves notes → visible to student in-app under Profile → "Tutor Notes"
12. Student taps "Revoke Access" → token invalidated → teacher sees "Access revoked" on next visit

### Token Lifecycle

| Status | Meaning |
|--------|---------|
| `pending` | Invite sent, teacher hasn't responded |
| `accepted` | Terms accepted, report accessible (90 days, auto-renewed on each visit) |
| `declined` | Teacher explicitly declined the terms — token permanently invalidated |
| `revoked` | Student revoked access — token permanently invalidated |
| `expired` | 90 days without a visit — student can re-invite |

## API Endpoints

### Authenticated Routes (student, JWT required)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/v1/tutor-sharing/invite` | Send invite. Body: `{ teacherEmail }`. Creates share row, sends SES email. |
| `GET` | `/v1/tutor-sharing/status` | Get current share status, teacher email, timestamps. |
| `DELETE` | `/v1/tutor-sharing/:shareId` | Revoke teacher access. |
| `GET` | `/v1/tutor-sharing/notes` | Get all teacher notes for display in-app. |

### Public Routes (teacher, token-authenticated)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/report/:token` | Main entry — renders Terms page (if not accepted) or full report (if accepted). |
| `POST` | `/report/:token/accept` | Accept Terms of Use. Updates status, sets `termsAcceptedAt`, redirects to report. |
| `POST` | `/report/:token/decline` | Decline Terms of Use. Sets status to `declined`, records `declinedAt`. |
| `POST` | `/report/:token/notes` | Submit a new note. Body: `{ noteText }`. |
| `POST` | `/report/:token/refresh-analysis` | Trigger on-demand AI analysis refresh. Rate limited: max 3/hour/token. |

### Internal Route (Lambda/cron)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/internal/tutor-analysis` | Daily cron: pre-compute AI analysis for all users with active shares. |

### Constraints

- One active share per student (MVP). Attempting to invite while a pending/accepted share exists returns an error. Student must revoke the existing share first.
- Student cannot invite their own email address.

### Security Notes

- `/report/:token` routes are not behind JWT auth — the 64-char crypto-random token is the credential
- Rate limiting on `/report/:token/refresh-analysis`: max 3 per hour per token to control LLM costs
- `/internal/tutor-analysis` requires `X-Internal-Secret` header (same pattern as existing daily-reminders Lambda)
- Note text is sanitized (stripped of HTML) before storage to prevent XSS in the server-rendered report

## Report Content & Sections

The report is a single long-form HTML page with a fixed nav sidebar for jumping between sections.

### 1. Student Overview

- Display name, avatar, learning start date
- Country, reasons for learning, interests (from `learner_profiles`)
- Current daily goal setting
- Current/longest streak

### 2. Placement History & Trajectory

- Table of all placement sessions (date, inferred level, accuracy by JLPT level)
- Trend chart: placement accuracy over time by level
- AI-inferred trajectory: "Progressing from N4 → N3, projected to reach N3 proficiency by [date]"
- Milestone forecast based on velocity + placement trend

### 3. Progress Snapshot

- SRS status distribution — donut chart with 4 tiers:
  - **Learning**: Currently being introduced and practiced at short intervals
  - **Reviewing**: Past initial learning, being tested at increasing intervals
  - **Remembered**: Correctly recalled the last 5 consecutive times over a span of ≥ 14 days
  - **Mastered** (burned): Fully graduated from review — consistent recall over 6+ months
- JLPT breakdown by level and SRS state — stacked bar chart
- Total kanji seen, remembered, completion %

### 4. Effort & Study Habits

- Daily study time chart (30-day and 90-day views)
- Reviews per day trend line
- Session frequency (avg sessions/day, weekend vs weekday ratio)
- Preferred study time of day
- Device distribution (phone / tablet / watch)

### 5. Learning Velocity

- Cards learned per day/week trend
- Burns per week trend
- Velocity classification (accelerating / steady / decelerating / inactive)
- New cards vs reviews ratio over time

### 6. Accuracy & Modality Analysis

- Accuracy by type: meaning / reading / writing / voice / compound — radar chart
- Weakest modality highlighted
- Leech count and top 5 leech kanji (persistent trouble spots)
- Writing practice avg score trend
- Voice practice pass rate trend

### 7. AI Analysis

- Pre-computed daily analysis with "Refresh Analysis" button
- Structured sections: Strengths, Areas for Improvement, Recommendations, Observations
- Tailored for a teacher audience (pedagogical language, actionable suggestions)

### 8. Teacher Notes

- Timestamped list of previous notes
- Text input + submit button to add a new note
- Notes visible to both teacher (here) and student (in-app)

## AI Analysis Structure

The LLM generates a structured JSON object cached in `tutor_analysis_cache.analysisJson`:

```json
{
  "strengths": [
    "Strong meaning recognition (92% accuracy)",
    "Consistent daily study habit — 23-day streak"
  ],
  "areasForImprovement": [
    "Reading accuracy significantly lower than meaning (61% vs 92%)",
    "Voice practice attempted only 3 times in 30 days"
  ],
  "recommendations": [
    "Focus reading drills on N4 kanji where accuracy is weakest",
    "Increase voice practice frequency to build pronunciation confidence"
  ],
  "observations": [
    "Study velocity has been accelerating over the past 2 weeks",
    "Placement test trajectory suggests N3 readiness by August"
  ],
  "generatedAt": "2026-04-13T00:00:00Z"
}
```

The LLM prompt includes: velocity metrics, accuracy by modality, streak data, placement history, leech list, SRS distribution, daily stats, and placement trajectory. It is instructed to write for a teacher audience — pedagogical, actionable, referencing specific data points.

LLM tier: Tier 3 (Claude) for daily pre-computation. Tier 2 (Groq/Gemini) acceptable for on-demand refresh to reduce cost.

## Mobile App Changes

### Profile Screen — New "Share with Tutor" Section

Added below the existing Social/Study Mates section.

| State | UI |
|-------|-----|
| No active share | Email input field + "Send Invite" button |
| Pending | "Invite sent to teacher@example.com" + "Cancel Invite" button |
| Accepted | "Connected to teacher@example.com" + "Revoke Access" button + note count badge |
| Declined | "Your teacher declined the invite" + "Send New Invite" button |

### Tutor Notes Sub-section

When an accepted share exists: scrollable list of timestamped teacher notes, read-only.

### New Hook

`useTutorSharing()` — manages invite/status/revoke/notes API calls via the existing `ApiClient`.

### Placement Persistence (Backend Only)

Update `POST /v1/placement/complete` in `placement.service.ts` to also insert into `placement_sessions` and `placement_results`. No mobile UI changes needed — it's backend-only persistence of data already being submitted.

## Email Template

**Sender:** `noreply@kanjibuddy.app` (AWS SES verified domain)

**Subject:** "[Student Name] has invited you to view their Japanese learning progress"

**Body:**
- Brief explanation of Kanji Buddy and the invitation
- What the teacher will see: progress data, effort trends, AI-assisted analysis
- CTA button: "View Learning Report" → `/report/:token`
- Footer: "This link is personal to you. It expires in 90 days. If you didn't expect this email, you can safely ignore it."

## Key Files to Modify

| File | Change |
|------|--------|
| `packages/db/src/schema.ts` | Add 5 new tables (tutor_shares, tutor_notes, tutor_analysis_cache, placement_sessions, placement_results) |
| `apps/api/src/server.ts` | Register new route modules (tutor-sharing, report) |
| `apps/api/src/routes/tutor-sharing.ts` | New file — authenticated student endpoints |
| `apps/api/src/routes/report.ts` | New file — public token-authenticated teacher report endpoints |
| `apps/api/src/services/tutor-sharing.service.ts` | New file — invite, revoke, status, token validation logic |
| `apps/api/src/services/tutor-report.service.ts` | New file — report data aggregation, "remembered" computation |
| `apps/api/src/services/tutor-analysis.service.ts` | New file — LLM analysis generation and caching |
| `apps/api/src/services/email.service.ts` | New file — AWS SES integration for invite emails |
| `apps/api/src/services/placement.service.ts` | Modify — persist placement sessions and results |
| `apps/api/src/cron.ts` | Add daily tutor analysis pre-computation job |
| `apps/lambda/daily-reminders/index.mjs` | Add call to `/internal/tutor-analysis` endpoint |
| `apps/api/src/templates/` | New directory — Handlebars/ETA templates for report pages (terms, report, declined, revoked) |
| `apps/mobile/app/(tabs)/profile.tsx` | Add "Share with Tutor" section and "Tutor Notes" sub-section |
| `apps/mobile/src/hooks/useTutorSharing.ts` | New file — hook for tutor sharing API calls |
| `packages/shared/src/types.ts` | Add TutorShare, TutorNote, PlacementSession, TutorAnalysis types |

## Future Expansion Path

This design supports future school features by:
- `tutor_shares` can evolve into a many-to-many relationship (multiple teachers per student, multiple students per teacher)
- The report rendering can be extracted into a standalone Next.js app consuming the same API endpoints
- Teacher notes can be extended to structured feedback (focus areas, kanji recommendations)
- A teacher dashboard listing all their students becomes a query across `tutor_shares` with status `accepted`
- Group lesson analytics aggregate multiple students' data using the same underlying analytics service
