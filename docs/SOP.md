# Kanji Learn — Development SOP

Standard operating procedures for building, testing, and deploying the Kanji Learn app.

---

## Local test-first loop

Before spending an EAS build or starting a TestFlight pass, use the local
protocol:

https://github.com/radmelon/kanji-learn/blob/main/docs/local-build-and-test-protocol.md

Minimum mobile gates:

```bash
pnpm --filter @kanji-learn/mobile test -- --runInBand
pnpm --filter @kanji-learn/mobile test:components
pnpm --filter @kanji-learn/mobile typecheck
```

The pure logic lane and the component render lane are intentionally separate.
Keep using pure helpers/reducers for decisions that do not require rendering;
use the component lane for focused JSX/React Native states before moving to
simulator, device, or TestFlight checks.

---

## TestFlight Build & Submission

### One-command release (preferred)
```bash
cd apps/mobile
eas build --platform ios --profile production --auto-submit --non-interactive
```

The `--auto-submit` flag tells EAS to **build AND submit** to App Store Connect in one step. Note: `autoSubmit` is NOT a valid `eas.json` key — it must be passed as a CLI flag. Apple processing takes 5–30 min after the EAS step completes; a TestFlight notification email arrives when it is ready.

### Manual submit (if build was run without autoSubmit)
If a build completed but never appeared in TestFlight, the `.ipa` was built but not submitted:
```bash
cd apps/mobile
eas submit --platform ios --latest --non-interactive
```

### Checking build status
```bash
eas build:list --platform ios --limit 5
```
The `Distribution: store` + `Status: finished` combination confirms the `.ipa` is built. A missing TestFlight entry always means submit was skipped — run `eas submit`.

### EAS + New Architecture gotchas (learned the hard way, B140, 2026-07-04)

1. **`apps/mobile/ios/` is gitignored** — EAS never sees your local `ios/` directory (except the 7 legacy-tracked Watch swift files). It runs prebuild + pod install fresh on the builder. Editing `ios/Podfile` or `ios/Podfile.properties.json` locally does NOTHING for EAS builds; only `app.json`, `eas.json`, and env vars reach the builder.
2. **RN 0.81.x precompiled release XCFrameworks break Release links under New Arch** — `Undefined symbols: facebook::react::Sealable` (a debug-guarded symbol source-compiled pods still reference). Local builds don't hit it (debug prebuilt has the symbols). Fix in `eas.json` production env: `RCT_USE_PREBUILT_RNCORE=0`, `RCT_USE_RN_DEP=0` (builds RN from source, ~+10 min per build). Revisit after upgrading past RN 0.81.5.
3. **Reading EAS build logs from the CLI:** `eas build:view --json <id>` → `logFiles` URLs (15-min signed) → the blobs are **brotli**-compressed; decode with `node -e "zlib.brotliDecompressSync(...)"`.
4. **NEVER hand-bump `ios.buildNumber` — `eas.json` production has `autoIncrement: true`** (learned B143, 2026-07-05: a manual 141→142 bump got auto-incremented at build time, so "B142" never existed and the binary shipped as 143). EAS bumps and writes app.json itself; just commit the auto-written value after each cut ("record buildNumber N").
5. **Stale-Metro-bundle trap (2026-07-05):** airplane-mode testing severs the dev client from Metro, and a later shake-reload can silently fail to fetch — the device then runs progressively older UI while you "fix" phantom bugs. Before debugging any on-device layout report, confirm bundle freshness against a known marker from the latest code; if reports contradict the code, reproduce in the iOS Simulator (`npx expo run:ios --port 8082`, throwaway Supabase admin-API user, `xcrun simctl openurl booted "kanjilearn://<route>"`) instead of patching blind.

### 🛑 Before cutting a mobile build, check whether the API is behind it (2026-07-27)

**A mobile build must never be cut without checking whether `apps/api` or
`packages/shared` changed since the last API deploy.** B144 was cut from mobile
code depending on four API commits that were never deployed. Four shipped
features were silently inert (B-214): the hook on the flashcard answer side and
the hint button (both gated on a queue field the deployed API did not return),
the "Not now" cooldown (route 404, swallowed by a `.catch`), and `hint_used`
persistence — plus a consent answer half-discarded, because **Zod's `z.object()`
strips unknown keys rather than erroring**, so an older schema drops new fields
in silence and returns 200.

Nothing warns you. The build succeeds, the app runs, the features just do
nothing.

Run this before every cut:

```bash
ARN=arn:aws:apprunner:us-east-1:087656010655:service/kanji-learn-api/470f4fc9f81c407e871228fb9dd93654
LAST=$(aws apprunner list-operations --service-arn "$ARN" --region us-east-1 \
  --query 'OperationSummaryList[?Status==`SUCCEEDED`]|[0].StartedAt' --output text)
echo "API last deployed: $LAST"
git log --since="$LAST" --oneline -- apps/api packages/shared
```

**Any output from that `git log` means deploy before you build.** `packages/shared`
counts because it carries the wire types both sides compile against — a field
added there is a promise the API has not yet made.

This is the same failure Plan 4 Task 5a exists to prevent (*"these fixes are
authored AFTER the deploy, so they need their own"*). That warning was in the
plan and repeated in the handoff, and it was still walked into four more times
in one session — which is why the fix here is a command, not a reminder.

### 🛑 Always set `EXPO_NO_CAPABILITY_SYNC=1` — for EVERY iOS build (2026-07-27)

**This applies to every profile, not just `development`.** It was first hit on a
development build and written up that way; the same failure then hit
`--profile production` on the Task 19 cut hours later. There is nothing
profile-specific about it — the capability sync runs against the bundle ID, and
every profile uses the same one.

`eas build` tried to switch **`APPLE_ID_AUTH` OFF** on
`com.rdennis.kanjilearn2` — the bundle ID of the **live App Store app**. Apple
refused (*"The bundle 'VYU8N3FTUT' cannot be deleted. Delete all the Apps
related to this bundle to proceed"*), which is the only reason production Sign
in with Apple survived. **Twice now.** Do not rely on a third refusal.

**Why it happens:** EAS auto-syncs portal capabilities against `app.json`.
Apple sign-in here is a **Supabase OAuth web redirect**
([`auth.store.ts:171`](../apps/mobile/src/stores/auth.store.ts) →
`signInWithOAuth`), not the native `expo-apple-authentication` module — so
`app.json` correctly omits `ios.usesAppleSignIn`, while the portal has the
capability enabled. EAS reads that as drift and tries to "correct" it by
disabling the capability in production.

**Do not fix this by adding `usesAppleSignIn: true`** unless you intend to adopt
the native module — that would declare a capability the app does not use. Skip
the sync instead:

```bash
# Development
EXPO_NO_CAPABILITY_SYNC=1 npx eas build --platform ios --profile development

# Production / TestFlight — the env var is NOT optional here either
EXPO_NO_CAPABILITY_SYNC=1 npx eas build --platform ios --profile production --auto-submit
```

**No build of any kind should mutate the production bundle's capabilities.**

**Why this is not in `eas.json`:** the `env` block in a build profile is applied
on the EAS *builder*, but capability syncing happens locally in the CLI during
the credentials step — before anything is uploaded. Setting it there would look
like a fix and change nothing. It has to be on the command line. If that ever
stops being true, move it and delete this paragraph.

**Failure mode to recognise:** the run dies at
`✖ Failed to sync capabilities`, after `✔ Bundle identifier registered`. No
build is created, so `autoIncrement` does **not** fire and `buildNumber` is
untouched — re-running does not skip a number.

### Registering a physical device for a development build

`eas device:create` → choose manual UDID entry; get the UDID from
`xcrun xctrace list devices` (device must be connected and trusted, or it shows
under *Devices Offline*). Then **Developer Mode** on the device: Settings →
Privacy & Security → Developer Mode → On → restart. Required on iOS 16+; the
install silently fails without it.

Note a dev build **replaces the TestFlight build** on that device (shared bundle
ID) — keep one device on TestFlight as the "what the tester sees" reference.

### Local device builds need an Xcode account

`xcodebuild ... error 65` with *"No Accounts: Add a new account in Accounts
settings"* followed by *"Provisioning profile … doesn't include the currently
selected device"* means Xcode has no signed-in Apple ID — the second error is a
consequence of the first, not a separate problem. Fix in Xcode → Settings →
Accounts (team `JN43UP9MQL`). The project itself is fine: `CODE_SIGN_STYLE =
Automatic` regenerates the profile and registers the device once an account
exists.

### Build credits
EAS has a monthly free-tier quota. Each build counts against it; overages are billed per-build. To debug without spending credits:
```bash
# Free local build — streams Metro logs to terminal, no EAS credit used
cd apps/mobile
npx expo run:ios --device
```
Use local builds for active crash debugging. Only submit a production EAS build when you are confident the fix is correct.

---

## API Deployment

### 🛑 Verify the deploy actually happened — status codes will lie to you (2026-07-27)

A full Phase 5 rollout was reported "verified" while App Runner was still serving a **May 30th image**. Two traps, both worth internalising:

1. **`deploy-api.sh` can fail early and quietly.** It starts with `docker build`, which dies outright if the Docker daemon is not running, and ECR login fails on a stale keychain entry (below). If you do not read the output to the end, nothing tells you the deploy never ran.
2. **"401 not 404" is NOT proof a route deployed.** `mnemonics.ts` has parametric `GET /:kanjiId` and `POST /:kanjiId`, so `/v1/mnemonics/refresh`, `/assemble` and `/buddy-moment-context` all match the parametric route on **any** version of the code and return 401 unauthenticated. The check passes identically against a build predating the feature.

**Verify these two things instead:**

```bash
# (a) An actual deployment dated today
aws apprunner list-operations \
  --service-arn arn:aws:apprunner:us-east-1:087656010655:service/kanji-learn-api/470f4fc9f81c407e871228fb9dd93654 \
  --region us-east-1 --query 'OperationSummaryList[0].[Type,Status,StartedAt]' --output text
```

**(b) Response CONTENT, using a field only the new code returns.** For Phase 5 the canary is `components` on `GET /v1/kanji/:id` (landed in `d621542`) — a key that cannot be faked by route shadowing. Pick an equivalent canary for whatever you are shipping.

### ECR login fails: `The specified item already exists in the keychain. (-25299)`

`docker login` uses `docker-credential-osxkeychain`, which tries to **add** rather than update and fails when a stale entry exists. **Neither `DOCKER_CONFIG=` nor `docker --config <dir>` avoids it** — the helper runs regardless. Delete the one stale item; `docker login` recreates it:

```bash
security delete-internet-password -s 087656010655.dkr.ecr.us-east-1.amazonaws.com
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin 087656010655.dkr.ecr.us-east-1.amazonaws.com
```

Expect `Login Succeeded`. Safe: it is a short-lived registry credential, not an account password.

### Quick deploy (source-based App Runner)
```bash
# From monorepo root — build TypeScript, push to git, trigger App Runner
cd apps/api && npm run build
git add apps/api/src && git commit -m "..."
git push
aws apprunner start-deployment \
  --service-arn arn:aws:apprunner:us-east-1:087656010655:service/kanji-learn-api/470f4fc9f81c407e871228fb9dd93654 \
  --region us-east-1
```

### Full Docker deploy (when Dockerfile changes)
```bash
cd /Users/rdennis/Documents/projects/kanji-learn
./scripts/deploy-api.sh
```

### Type-check before deploying
```bash
cd apps/api && npx tsc --noEmit
```
Always run this before pushing — App Runner deploys whatever is in `main`.

---

## Watch App Changes

The Watch app source exists in **two locations** that must always be kept in sync:

| Location | Purpose |
|---|---|
| `apps/watch/KanjiLearnWatch/` | Git-tracked source of truth |
| `apps/mobile/ios/KanjiLearnWatch/` | Xcode build source (what actually compiles) |

**Any Swift file edit must be applied to both directories.** Editing only one will cause the build to use stale code.

---

## Crash Debugging Playbook

### Identify crash type
- **"RCTFatal / RCTExceptionsManager"** in Xcode stack → JS exception reported through native bridge. The actual error is a JavaScript TypeError, not a native ObjC crash.
- **"undefined is not a function"** → something called as a function is `undefined`. Common cause: calling `.map()` or `.join()` on a string instead of an array (the `?? []` guard does NOT catch non-null truthy values — use `Array.isArray()`).
- **"Cannot read property X of null/undefined"** → accessing a property on null/undefined.

### Surfacing render errors (error boundary)
`study.tsx` wraps the study session in `StudyErrorBoundary`. Render errors show an alert dialog with the full JS stack trace. If a crash reaches a black screen without the dialog, the error is in an event handler — those are wrapped in try/catch with `Alert.alert` in `handleGrade`.

### TTS / expo-speech rules
- `Audio.setAudioModeAsync({ playsInSilentModeIOS: true })` is called **once at module scope** in `_layout.tsx`. Do NOT call it from component effects — expo-av v16 becomes unstable when called repeatedly.
- Call `Speech.stop()` **only when `speakingGroup !== null`**. Calling it on an idle synthesizer crashes the native bridge.
- Do NOT add `key={currentIndex}` to `KanjiCard`. This forces full remount on every grade press and triggers `Speech.stop()` in cleanup on an idle synthesizer → RCTFatal.

### Array field safety
All array fields from the API (`meanings`, `kunReadings`, `onReadings`, `radicals`, `exampleVocab`, `exampleSentences`) must be guarded with:
```ts
// CORRECT — catches null, undefined, AND non-array truthy values (strings, objects)
const meanings = Array.isArray(item.meanings) ? item.meanings : []

// WRONG — only catches null/undefined; a string passes through and .map() crashes
const meanings = item.meanings ?? []
```
This applies on **both** the server (`srs.service.ts`) and the client (`KanjiCard.tsx`, `CompoundCard.tsx`).

---

## Git Workflow

```bash
# Standard commit
git add apps/api/src/... apps/mobile/src/...   # name files explicitly
git commit -m "fix: descriptive message"
git push

# Never use git add -A or git add . — credentials.json and large binaries
# will accidentally be staged.
```

---

## Key File Reference

| File | Role |
|---|---|
| `apps/mobile/app/(tabs)/study.tsx` | Study session — PanResponder, handleGrade, error boundary |
| `apps/mobile/src/components/study/KanjiCard.tsx` | Flip card, TTS, RevealAllDrawer |
| `apps/mobile/src/components/study/CompoundCard.tsx` | Compound vocab card |
| `apps/mobile/app/_layout.tsx` | Root layout — Audio session init (module scope) |
| `apps/api/src/services/srs.service.ts` | Review queue builder, SRS logic |
| `apps/mobile/eas.json` | EAS build profiles (autoSubmit: true on production) |
| `scripts/deploy-api.sh` | Docker build + ECR push + App Runner trigger |
| `apps/watch/KanjiLearnWatch/` | Watch app Swift source (git-tracked) |
| `apps/mobile/ios/KanjiLearnWatch/` | Watch app Swift source (Xcode build) |
