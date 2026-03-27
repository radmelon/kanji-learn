# 漢字 Learn

A spaced-repetition Japanese Jouyou kanji learning app — 2,136 kanji, JLPT N5→N1, with AI-generated mnemonics, stroke-order writing practice, and voice reading evaluation.

## Stack

| Layer | Technology |
|---|---|
| Mobile | React Native + Expo SDK 54 (expo-router) |
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

- **Node.js** ≥ 20 (use [nvm](https://github.com/nvm-sh/nvm): `nvm use 20`)
- **pnpm** ≥ 9 (`npm install -g pnpm`)
- **Expo Go** SDK 54 on your iOS/Android device or simulator
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

Edit `apps/api/.env` with your values:

| Variable | Where to find it |
|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database → Connection string (URI) |
| `SUPABASE_JWT_SECRET` | Supabase → Project Settings → API → JWT Secret |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → service_role key |
| `ANTHROPIC_API_KEY` | [console.anthropic.com/keys](https://console.anthropic.com/keys) |

### 3. Configure the mobile app

```bash
cp apps/mobile/.env.example apps/mobile/.env.local
```

Edit `apps/mobile/.env.local`:

| Variable | Where to find it |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon/public key |
| `EXPO_PUBLIC_API_URL` | `http://localhost:3000` for local dev |

### 4. Run database migrations

```bash
pnpm --filter @kanji-learn/db db:migrate
```

### 5. Seed kanji reference data

Inserts all 2,136 Jouyou kanji (N5→N1) into the `kanji` table. Safe to re-run (upsert).

```bash
pnpm --filter @kanji-learn/db seed:kanji
```

### 6. (Optional) Pre-seed AI mnemonics

Calls Claude Haiku to generate a system mnemonic for every kanji. Skips already-seeded rows. Requires `ANTHROPIC_API_KEY` — the script reads from `packages/db/.env`.

```bash
# Copy API env to packages/db so the seed script can read it
cp apps/api/.env packages/db/.env

pnpm --filter @kanji-learn/db seed:mnemonics
```

> ⚠️ This makes ~2,136 Haiku API calls. At current pricing that's roughly **$0.30–0.50** total. The script runs 5 concurrent requests with exponential backoff and skips already-seeded rows, so it's safe to re-run.

## Development

Start both servers in parallel:

```bash
pnpm dev
```

Or individually:

```bash
# API — http://localhost:3000
pnpm --filter @kanji-learn/api dev

# Mobile — opens Expo QR code
pnpm --filter @kanji-learn/mobile dev
```

Scan the QR code with **Expo Go** (iOS) or the Camera app (Android).

## Scripts Reference

| Command | Description |
|---|---|
| `pnpm dev` | Start all apps in dev mode (turbo) |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | TypeScript check across all packages |
| `pnpm lint` | ESLint across all packages |
| `pnpm format` | Prettier format everything |
| `pnpm --filter @kanji-learn/db db:generate` | Generate Drizzle migration from schema changes |
| `pnpm --filter @kanji-learn/db db:migrate` | Apply pending migrations |
| `pnpm --filter @kanji-learn/db db:studio` | Open Drizzle Studio (visual DB browser) |
| `pnpm --filter @kanji-learn/db seed:kanji` | Seed all 2,136 kanji |
| `pnpm --filter @kanji-learn/db seed:mnemonics` | Pre-seed Claude Haiku mnemonics |

## Database Schema (key tables)

```
kanji               — 2,136 Jouyou kanji with readings, meanings, radicals, vocab
mnemonics           — AI-generated (system) + user-authored mnemonic stories
user_profiles       — Supabase auth mirror + preferences
user_kanji_progress — SM-2 SRS state per user per kanji
review_sessions     — Batched study sessions
review_logs         — Individual answer records
writing_attempts    — Stroke-order practice results
voice_attempts      — Reading pronunciation evaluation results
daily_stats         — Streak and study-time tracking
```

## CI / CD

| Workflow | Trigger | What it does |
|---|---|---|
| **CI** | Push / PR → `main` | Typecheck · lint · build API |
| **DB Schema Check** | PR touching `schema.ts` | Fails if un-generated migrations exist |
| **EAS Preview Build** | PR touching `apps/mobile` | Builds iOS + Android preview via EAS |

### Required GitHub Secrets

Go to **Settings → Secrets and variables → Actions** and add:

| Secret | Description |
|---|---|
| `DATABASE_URL` | Supabase connection string |
| `EXPO_TOKEN` | From `eas whoami` / [expo.dev](https://expo.dev/accounts) |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `EXPO_PUBLIC_API_URL` | Deployed API base URL |

## Architecture Notes

- **SRS algorithm** — SM-2 with statuses: `unseen → learning → reviewing → remembered → burned`
- **Kanji ordering** — JLPT N5 first (most frequent in daily use), N1 last
- **Mnemonics** — system mnemonics seeded by Claude Haiku (30-day refresh nudge) plus user-authored overrides
- **Writing practice** — `@shopify/react-native-skia` canvas; requires a native dev build (`expo run:ios`), not Expo Go
- **Voice evaluation** — `expo-speech-recognition` → wanakana transliteration → Levenshtein distance scoring
- **Auth** — Supabase Auth (email + OAuth), session persisted in `expo-secure-store`
- **New Architecture** — project runs on React Native New Architecture (Fabric/JSI) as required by Expo Go SDK 54
