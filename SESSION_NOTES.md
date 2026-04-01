# Kanji Learn — Session Notes
_Last updated: 2026-04-01_

---

## Current State

The app is fully functional on a physical iPhone device. Metro, the API server, and Supabase are all wired together and tested end-to-end.

### What works
- SRS flashcard study (kanji, reading, compound review stages)
- Compound reading cards (readingStage 4) via `CompoundCard`
- Mnemonic journal: view, create (compose + AI Haiku/Sonnet), edit, delete
- Photo attachment on user mnemonics (expo-image-picker, base64 data URL)
- Multiple-choice kanji quiz (test sessions with score + pass/fail)
- Push notification registration (EAS projectId from expo.dev)
- Daily study reminders (cron at 20:00)
- Physical device Metro connection (ip.txt bypass for isPackagerRunning)

---

## How to Start a Dev Session

### 1. API server
```bash
cd /Users/rdennis/Documents/projects/kanji-learn/apps/api
pnpm dev
```
Must see: `🚀 API server listening on 0.0.0.0:3000`

### 2. Metro bundler
```bash
cd /Users/rdennis/Documents/projects/kanji-learn/apps/mobile
npx expo start --dev-client
```

### 3. App on device
- Open the KanjiLearn app on iPhone — it reads `ip.txt` to find Metro
- If `ip.txt` is stale (IP changed), update it:
  ```bash
  # find your Mac's current LAN IP
  ipconfig getifaddr en0
  # write it into the bundle
  echo "192.168.X.X" > apps/mobile/ios/KanjiLearn/ip.txt
  ```
  Then rebuild in Xcode.

### If you need a full rebuild (after expo prebuild --clean)
```bash
cd apps/mobile
npx expo prebuild --platform ios --clean
open ios/KanjiLearn.xcworkspace
# Build with ⌘R in Xcode, then start Metro separately
```
The `withXcode16Fix` config plugin handles:
- fmt consteval → constexpr patch
- Podfile post_install flags
- AppDelegate ip.txt bundleURL patch
- ENABLE_USER_SCRIPT_SANDBOXING = NO

---

## Repo Structure

```
kanji-learn/
├── apps/
│   ├── api/                  Fastify API server
│   │   ├── src/
│   │   │   ├── index.ts      Entry — dotenv loaded via dynamic import
│   │   │   ├── server.ts     Fastify setup, routes registration
│   │   │   ├── routes/
│   │   │   │   ├── mnemonics.ts
│   │   │   │   ├── review.ts
│   │   │   │   ├── test.ts
│   │   │   │   ├── kanji.ts
│   │   │   │   └── ...
│   │   │   └── services/
│   │   │       ├── mnemonic.service.ts   AI generation via Anthropic SDK
│   │   │       ├── review.service.ts
│   │   │       └── test.service.ts
│   │   └── .env              ANTHROPIC_API_KEY, DATABASE_URL, SUPABASE_*
│   └── mobile/               Expo / React Native app
│       ├── app/
│       │   ├── (tabs)/
│       │   │   ├── index.tsx     Dashboard
│       │   │   ├── study.tsx     SRS flashcards
│       │   │   └── journal.tsx   Mnemonic journal
│       │   └── test.tsx          Multiple-choice quiz
│       ├── src/
│       │   ├── components/
│       │   │   ├── study/
│       │   │   │   ├── KanjiCard.tsx
│       │   │   │   └── CompoundCard.tsx
│       │   │   └── mnemonics/
│       │   │       └── MnemonicCard.tsx  (photo hooks live here)
│       │   ├── hooks/
│       │   │   ├── useMnemonics.ts       updatePhoto() added
│       │   │   └── usePushNotifications.ts
│       │   └── lib/
│       │       └── api.ts                ApiClient — no body = no Content-Type header
│       ├── plugins/
│       │   └── withXcode16Fix.js         Config plugin for Xcode 16 compat
│       └── app.json                      EAS projectId, NSPhotoLibraryUsageDescription
├── packages/
│   ├── db/
│   │   ├── src/schema.ts     mnemonics table has image_url column
│   │   └── drizzle/          migrations 0000–0003
│   └── shared/
│       └── src/types.ts      TestQuestion, TestSubmission etc.
```

---

## Known Gotchas

| Issue | Fix |
|-------|-----|
| API server won't start: `EADDRINUSE` | `lsof -ti :3000 \| xargs kill -9` |
| API server won't start: `DATABASE_URL required` | dotenv must be dynamic import in index.ts — already fixed |
| Metro not connecting on device | Check `ip.txt` has current LAN IP; grant Local Network permission |
| fmt consteval build errors | Re-run `expo prebuild --clean`; plugin patches base.h |
| Podfile post_install not injected | Plugin regex anchors to file tail — already fixed |

---

## Remaining Roadmap Items

| # | Feature | Notes |
|---|---------|-------|
| 7 | **Location hooks** | Attach lat/lng to mnemonic at creation time; store in `mnemonics` table |
| 12 | **Social features** | Friend list, leaderboard by review streak/count |
| 19–20 | **README + final cleanup** | Document setup, environment variables, architecture |

### Location hooks (next up)
- Add `latitude` + `longitude` columns to `mnemonics` table (migration 0004)
- `expo-location` — request `requestForegroundPermissionsAsync` on mnemonic create
- Store coords in DB via PATCH or at creation in POST
- Show location badge on MnemonicCard (city name via reverse geocode or raw coords)
- Add `NSLocationWhenInUseUsageDescription` to `app.json`

---

## Key Config Values

| Value | Where |
|-------|-------|
| EAS projectId | `app.json` → `extra.eas.projectId` = `0c1f17c5-e267-44ce-84cb-3ad467d6f9fa` |
| Supabase URL | `apps/mobile/.env.local` + `apps/api/.env` |
| Anthropic API key | `apps/api/.env` only (never in mobile) |
| Bundle ID | `com.rdennis.kanjilearn2` |
| Expo owner | `radmelon` |
