# 漢字 Learn

A spaced-repetition Japanese Jouyou kanji learning app — 2,136 kanji, JLPT N5→N1, with AI-generated mnemonics, stroke-order writing practice, and voice reading evaluation.

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
- **Expo Go SDK 54** on your iOS/Android device ([App Store](https://apps.apple.com/app/expo-go/id982107779))
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

Start the API and mobile bundler in separate terminal tabs:

```bash
# Terminal 1 — API (http://localhost:3000)
pnpm --filter @kanji-learn/api dev

# Terminal 2 — Expo Metro bundler
pnpm --filter @kanji-learn/mobile dev
```

Scan the QR code with **Expo Go** on your phone. Both must be on the same Wi-Fi network.

> The `pnpm dev` turbo command also works but streams both logs together.

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
mnemonics           — AI-generated (system) + user-authored mnemonic stories
user_profiles       — Supabase auth mirror + preferences (daily goal, etc.)
user_kanji_progress — SM-2 SRS state per user per kanji (status, ease, interval,
                      next_review_at, reading_stage)
review_sessions     — Batched study sessions with timing and score summary
review_logs         — Individual answer records (quality 0–5, response time)
writing_attempts    — Stroke-order practice scores
voice_attempts      — Reading pronunciation evaluation results
daily_stats         — Per-day review counts, accuracy, streak tracking
interventions       — Absence / plateau / mnemonic-refresh nudge records
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
- **Mnemonics** — Claude Haiku system mnemonics (30-day refresh nudge) + user-authored overrides
- **Writing practice** — `@shopify/react-native-skia` canvas; requires a **native dev build** (`expo run:ios`), not Expo Go
- **Voice evaluation** — `expo-speech-recognition` → wanakana transliteration → Levenshtein distance scoring
- **Auth** — Supabase Auth (email + OAuth), session persisted in `expo-secure-store`
- **New Architecture** — Expo Go SDK 54 runs Fabric/JSI (New Architecture); project is fully compatible
- **Expo Go vs dev build** — Skia writing practice requires `expo run:ios` / EAS build; all other features work in Expo Go

## Troubleshooting

**`ERR_MODULE_NOT_FOUND: NativeSetup`** — Wrong Node.js version. Use Node 20 LTS (`nvm use 20`).

**`supabaseUrl is required`** — `apps/mobile/.env.local` is missing or not loaded. Restart Metro after creating it.

**`ENOTFOUND db.[ref].supabase.co`** — Use the Session pooler URL from Supabase dashboard, not the direct connection hostname.

**`relation "kanji" does not exist`** — Migrations haven't been applied. Run `db:generate` then `db:migrate` before seeding.

**"All caught up!" with empty queue** — Either the `kanji` table is empty (run `seed:kanji:fetch`) or the API isn't reachable (check `EXPO_PUBLIC_API_URL` uses your Mac's LAN IP, not `localhost`).

**API throws `Cannot find package 'drizzle-orm'`** — Run `pnpm install` from the monorepo root to ensure all workspace deps are linked.
