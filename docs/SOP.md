# Kanji Learn — Development SOP

Standard operating procedures for building, testing, and deploying the Kanji Learn app.

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
