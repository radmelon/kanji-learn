# 漢字 Learn

A spaced-repetition Japanese Jouyou kanji learning app — 2,136 kanji, JLPT N5→N1, with AI-generated mnemonics, location-tagged memory aids, social study mates, leaderboards, stroke-order writing practice, and voice reading evaluation.

## Stack

| Layer | Technology |
|---|---|
| Mobile | React Native + Expo SDK 54 (expo-router 6) |
| API | Node.js + Fastify + Drizzle ORM |
| Database | Supabase (PostgreSQL) |
| AI | Anthropic Claude (Haiku for bulk seeding, Sonnet for live generation) |
| Monorepo | Turborepo + pnpm workspaces |

## Monorepo Structure

```
kanji-learn/
├── apps/
│   ├── mobile/          # Expo React Native app
│   └── api/             # Fastify REST API
└── packages/
    ├── db/              # Drizzle schema, migrations, seed scripts
    └── shared/          # Types and utilities shared across apps
```

## Prerequisites

- **Node.js 20 LTS** — required; newer versions (v22+) break Expo's module resolution
  ```bash
  # Install nvm, then:
  nvm install 20 && nvm use 20
  ```
- **pnpm** ≥ 9
  ```bash
  npm install -g pnpm
  ```
- **Xcode 16+** (iOS builds) or **Android Studio** — required for the native dev build
- **Supabase** project ([supabase.com](https://supabase.com))
- **Anthropic API key** ([console.anthropic.com](https://console.anthropic.com))

## Setup

### 1. Clone and install

```bash
git clone git@github.com:radmelon/kanji-learn.git
cd kanji-learn
pnpm install
```

### 2. Configure the API

```bash
cp apps/api/.env.example apps/api/.env
```

Edit `apps/api/.env`:

| Variable | Where to find it |
|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database → **Connection string → Session pooler (port 5432)** |
| `SUPABASE_JWT_SECRET` | Supabase → Project Settings → API → JWT Secret (click eye icon) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` key (click eye icon) |
| `ANTHROPIC_API_KEY` | [console.anthropic.com/keys](https://console.anthropic.com/keys) |

> ⚠️ Use the **Session pooler** URL (port 5432), not the direct connection or Transaction pooler.
> The URL format is: `postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres`

### 3. Configure the mobile app

```bash
cp apps/mobile/.env.example apps/mobile/.env.local
```

Edit `apps/mobile/.env.local`:

| Variable | Where to find it |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` / public key |
| `EXPO_PUBLIC_API_URL` | Your Mac's **local IP** (not `localhost`) — e.g. `http://192.168.1.x:3000` |

> ⚠️ Use your Mac's LAN IP for `EXPO_PUBLIC_API_URL` — your phone cannot reach `localhost` on your computer.
> Find it with `ipconfig getifaddr en0` (macOS) or check System Settings → Wi-Fi → Details.

### 4. Run database migrations

Copy the API env to the db package so seed scripts can read it:

```bash
cp apps/api/.env packages/db/.env
```

Then generate and apply migrations:

```bash
# Generate SQL from schema (creates packages/db/drizzle/)
pnpm --filter @kanji-learn/db db:generate

# Apply to Supabase
pnpm --filter @kanji-learn/db db:migrate
```

### 5. Seed kanji reference data

Fetches all 2,136 Jōyō kanji from [kanjiapi.dev](https://kanjiapi.dev) (free, no key needed) and upserts them into the `kanji` table. Safe to re-run. Takes ~3–5 minutes.

```bash
pnpm --filter @kanji-learn/db seed:kanji:fetch
```

### 6. (Optional) Pre-seed AI mnemonics

Calls Claude Haiku to generate a system mnemonic for every kanji. Requires `ANTHROPIC_API_KEY` in `packages/db/.env`. Skips already-seeded rows — safe to re-run.

```bash
pnpm --filter @kanji-learn/db seed:mnemonics
```

> ⚠️ Makes ~2,136 Haiku API calls. At current pricing roughly **$0.30–0.50** total.
> Runs 5 concurrent requests with exponential backoff.

## Development

The app requires a **native dev build** (not plain Expo Go) because it uses `expo-location`, `@shopify/react-native-skia`, and other modules with native code.

#### First time: build the native app

```bash
cd apps/mobile
npx expo prebuild --platform ios --clean
open ios/KanjiLearn.xcworkspace   # build with ⌘R in Xcode, then return here
```

The `withXcode16Fix` config plugin handles Xcode 16 compatibility automatically (consteval patches, Podfile flags, AppDelegate ip.txt bundle URL, `ENABLE_USER_SCRIPT_SANDBOXING = NO`).

#### Physical device: tell Metro your Mac's IP

The app reads `apps/mobile/ios/KanjiLearn/ip.txt` to locate Metro (phones can't reach `localhost`):

```bash
ipconfig getifaddr en0               # find your Mac's current LAN IP
echo "192.168.x.x" > apps/mobile/ios/KanjiLearn/ip.txt
```

Rebuild in Xcode after changing `ip.txt`.

#### Daily dev start

```bash
# Terminal 1 — API (http://localhost:3000)
pnpm --filter @kanji-learn/api dev

# Terminal 2 — Metro bundler
cd apps/mobile && npx expo start --dev-client
```

Open the KanjiLearn app already installed on your device — it connects to Metro automatically. Both must be on the same Wi-Fi network.

## Scripts Reference

| Command | Description |
|---|---|
| `pnpm dev` | Start all apps in dev mode (turbo) |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | TypeScript check across all packages |
| `pnpm lint` | ESLint across all packages |
| `pnpm format` | Prettier format everything |
| `pnpm --filter @kanji-learn/db db:generate` | Generate Drizzle migration from schema changes |
| `pnpm --filter @kanji-learn/db db:migrate` | Apply pending migrations to Supabase |
| `pnpm --filter @kanji-learn/db db:studio` | Open Drizzle Studio (visual DB browser) |
| `pnpm --filter @kanji-learn/db seed:kanji` | Seed from static TS data files (N5/N4 only, includes example vocab) |
| `pnpm --filter @kanji-learn/db seed:kanji:fetch` | Seed all 2,136 kanji via kanjiapi.dev (recommended) |
| `pnpm --filter @kanji-learn/db seed:mnemonics` | Pre-seed Claude Haiku mnemonics |

## Database Schema (key tables)

```
kanji               — 2,136 Jouyou kanji: character, JLPT level/order, stroke count,
                      meanings, on/kun readings, radicals, example vocab, SVG path
mnemonics           — AI-generated (system) + user-authored mnemonic stories;
                      user mnemonics include optional lat/lng (location at creation time)
user_profiles       — Supabase auth mirror: display_name, email, daily_goal,
                      notifications_enabled, timezone
user_kanji_progress — SM-2 SRS state per user per kanji (status, ease, interval,
                      next_review_at, reading_stage)
review_sessions     — Batched study sessions with timing and score summary
review_logs         — Individual answer records (quality 0–5, response time)
writing_attempts    — Stroke-order practice scores
voice_attempts      — Reading pronunciation evaluation results
daily_stats         — Per-day review counts, accuracy, streak tracking
interventions       — Absence / plateau / mnemonic-refresh nudge records
friendships         — Study mate relationships: requester_id, addressee_id,
                      status (pending / accepted / declined)
```

## CI / CD

| Workflow | Trigger | What it does |
|---|---|---|
| **CI** | Push / PR → `main` | Typecheck · lint · build API · upload artifact |
| **DB Schema Check** | PR touching `schema.ts` or `drizzle/` | Fails if un-generated migrations exist |
| **EAS Preview Build** | PR touching `apps/mobile/` or `packages/shared/` | Builds iOS simulator + Android preview via EAS |

### Required GitHub Secrets

Go to **Settings → Secrets and variables → Actions** and add:

| Secret | Description |
|---|---|
| `EXPO_TOKEN` | From [expo.dev](https://expo.dev/accounts) → Account Settings → Access Tokens |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase `anon` key |
| `EXPO_PUBLIC_API_URL` | Your deployed API base URL |

> `DATABASE_URL` is **not** required for CI — only the EAS build needs the Supabase public keys.

## Architecture Notes

- **SRS algorithm** — SM-2 with statuses: `unseen → learning → reviewing → remembered → burned`
- **Kanji ordering** — JLPT N5 first (most frequent in daily use), N1 last
- **New cards per session** — up to 20, fills remaining slots after due reviews, ordered N5→N1
- **Mnemonics** — Claude Haiku system mnemonics (30-day refresh nudge) + user-authored overrides; `expo-location` captures lat/lng at creation time; a reverse-geocoded city badge is shown on each card
- **Social** — Friend search by email, in-app friend requests (pending/accept/decline), iOS Share sheet invite for users not yet in the system; leaderboard shows friends + self ranked by streak and review count, falls back to global top 10 if no friends yet
- **Writing practice** — `@shopify/react-native-skia` canvas; requires a native dev build
- **Voice evaluation** — `expo-speech-recognition` → wanakana transliteration → Levenshtein distance scoring
- **Auth** — Supabase Auth (email + OAuth), session persisted in `expo-secure-store`; email is synced into `user_profiles` on each profile fetch so friend search works without a service-role key
- **Native dev build required** — the app uses `expo-location`, Skia, and speech recognition which all require native modules; plain Expo Go is not supported

## Troubleshooting

**`ERR_MODULE_NOT_FOUND: NativeSetup`** — Wrong Node.js version. Use Node 20 LTS (`nvm use 20`).

**`supabaseUrl is required`** — `apps/mobile/.env.local` is missing or not loaded. Restart Metro after creating it.

**`ENOTFOUND db.[ref].supabase.co`** — Use the Session pooler URL from Supabase dashboard, not the direct connection hostname.

**`relation "kanji" does not exist`** — Migrations haven't been applied. Run `db:generate` then `db:migrate` before seeding.

**"All caught up!" with empty queue** — Either the `kanji` table is empty (run `seed:kanji:fetch`) or the API isn't reachable (check `EXPO_PUBLIC_API_URL` uses your Mac's LAN IP, not `localhost`).

**API throws `Cannot find package 'drizzle-orm'`** — Run `pnpm install` from the monorepo root to ensure all workspace deps are linked.

**Location permission dialog never appears** — Rebuild the native app after adding `expo-location` to `app.json`. The `NSLocationWhenInUseUsageDescription` key must be present in the compiled `Info.plist`.

**Friend search returns no results** — Email is synced into `user_profiles` on first profile GET after login. The target user must have opened the app at least once so their email is stored.

**Metro not connecting on device after IP change** — Update `apps/mobile/ios/KanjiLearn/ip.txt` with the new LAN IP and rebuild in Xcode.
