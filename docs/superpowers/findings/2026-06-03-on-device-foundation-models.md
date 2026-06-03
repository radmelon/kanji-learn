# Findings — On-Device Apple Foundation Models Enablement (Phase 5 Plan 3a)

**Date:** 2026-06-03 · **Branch:** `phase-5-on-device` · **Verified on:** iPhone 15 Pro / iOS 26.5

## What shipped

- **Assembly prompt extracted to `@kanji-learn/shared`** (`mnemonics/assembly-prompt.ts`) — one source for the cloud tier (API) and the on-device tier (mobile).
- **New Architecture enabled** (`apps/mobile/app.json` `newArchEnabled: true`). **This affects every build, including production B-cuts** — intended, not incidental.
- **Watch config plugins removed** (`withWatchApp`, `withWatchConnectivity`). The watchOS app is being deprecated/reconceptualized; its manual code-signing conflicted with local automatic signing under `expo run:ios`. Removing them unblocked the local device build and is consistent with the deprecation. (Reverting = re-add the two plugin lines to `app.json`.)
- **`@react-native-ai/apple@0.12.0`** added. We use the **direct `AppleFoundationModels` TurboModule** (`isAvailable()` + `generateText(messages, options)`), **NOT** the Vercel AI SDK path — `expo install ai` resolved `ai@6` while the library documents AI SDK v5, so the direct module sidesteps the version conflict and the extra dependency.
- **`apps/mobile/src/mnemonics/assembleOnDevice.ts`** — the seam Plan 3b's cascade calls. Throws `OnDeviceUnavailableError` on unavailability/empty output, so the cascade always falls back to cloud → template. Verified on-device offline (airplane mode): a coherent, slot-grounded 持 story.

## Requirements / gotchas (for the next engineer)

- **iOS 26 + Apple Intelligence enabled + an eligible device** (15 Pro+). `AppleFoundationModels.isAvailable()` is `false` otherwise → cascade falls back. No hard dependency: keyless/older devices still get cloud → template.
- **Native module changes need a full rebuild** (`expo prebuild --clean && expo run:ios --device`) — JS hot-reload does NOT register a new TurboModule. (Cost us a debugging loop: the probe screen loaded via Metro but the binary predated the library.)
- **Local dev build env** in a worktree: copy the gitignored `apps/api/.env`, `apps/api/.env.test`, and `apps/mobile/.env.local` into the worktree; the dev shell exports an **empty `ANTHROPIC_API_KEY`** that overrides `.env`, so start the API with `env -u ANTHROPIC_API_KEY pnpm --filter @kanji-learn/api dev`.
- **Device deep-link** to a route: `kanjilearn://<route>` tapped from the iOS **Notes** app (simulator-only `uri-scheme --ios` and `devicectl open url` were unreliable here).

## Pre-launch carry-over (memory `project_testing_phase_flags`)

- The cascade is **cloud-first during testing**. Before public release, flip **keyless** users to **on-device-first** (`on-device → template`, our key not used) and ship the **BYOK UI + secure storage**. The `assembleStory` cascade (Plan 3b) carries a `// PRE-LAUNCH: reorder for keyless users` marker.
