# Local Build and Test Protocol

Portable protocol for Expo apps that need cheap local feedback before spending
EAS/TestFlight builds. Written from the KanjiBuddy spike on 2026-07-29, and
intended to transfer to ABC Spike Phonics with only package names and app routes
changed.

## Goal

Use local tests and simulator runs for the checks that can be local, and reserve
physical-device or TestFlight passes for the things that genuinely require
native hardware, Apple services, or production credentials.

## Test Lanes

### 1. Pure logic lane

Keep pure logic tests on the existing `ts-jest` + `node` lane. This lane is
fast, stable, and good for reducers, queue selection, text segmentation, API
payload builders, and other code that does not need React Native rendering.

```bash
pnpm --filter @kanji-learn/mobile test -- --runInBand
```

KanjiBuddy baseline after the spike:

- 17 suites
- 136 tests
- `apps/mobile/jest.config.js`
- excludes `apps/mobile/test/components/`

Portable rule: put reusable decisions in `src/lib/`, `src/mnemonics/`, or a
pure reducer next to a thin hook before reaching for a component test.

### 2. Component render lane

Use `jest-expo` and React Native Testing Library for focused component tests
that need JSX, React Native primitives, or Expo/React Native ESM transforms.

```bash
pnpm --filter @kanji-learn/mobile test:components
```

KanjiBuddy spike result:

- `apps/mobile/jest.components.config.js`
- `apps/mobile/test/setup-components.ts`
- `apps/mobile/test/components/OfflineBanner.test.tsx`
- proves a real `.tsx` component can render locally

The component lane is intentionally separate from the logic lane for now. That
keeps the existing 136 tests protected while the component harness earns trust.
Do not collapse the lanes until several real components pass without recurring
setup churn.

### 3. Typecheck lane

Run TypeScript after either test lane changes. The app tsconfig includes test
files, so setup files and test imports are covered.

```bash
pnpm --filter @kanji-learn/mobile typecheck
```

## Dependency Baseline

For Expo SDK 54 / React 19.1 in KanjiBuddy, the working test stack is:

- `jest-expo@54.0.17`
- `@testing-library/react-native@13.3.3`
- `react-test-renderer@19.1.0`
- `jest@29.7.0`
- `babel-jest@29.7.0`
- `@types/jest@29.5.14`

Do not use latest `jest-expo` by default. Match the Expo SDK major line first.
In this repo, `jest-expo@54` failed under Jest 30 inside Expo runtime setup; the
component lane passed after aligning Jest and Babel-Jest to 29.

For ABC Spike Phonics, start by matching its Expo SDK line:

```bash
pnpm --filter <mobile-package> add -D \
  jest-expo@<expo-sdk-major>.x \
  @testing-library/react-native@13.3.3 \
  react-test-renderer@<react-version> \
  jest@29.7.0 \
  babel-jest@29.7.0 \
  @types/jest@29.5.14
```

If ABC already uses a newer Expo/Jest pairing, evaluate from its lockfile rather
than copying these versions blindly.

## Component Test Pattern

Write the smallest component test that asserts user-visible behavior. Avoid
starting with app routes, stores, auth, navigation, or network hooks.

Good first candidates:

- Empty/error/loading banners
- Presentational cards
- Buttons with local disabled/loading state
- Small sheets with supplied props and callback spies

Avoid as first candidates:

- Expo Router screens
- Supabase-backed screens
- Components that start TTS, haptics, notifications, location, or speech
  recognition on render

When a native module causes async setup noise unrelated to the assertion, mock
that module in `test/setup-components.ts`. Keep the mock narrow and do not
assert on the mock itself.

## Local App Loop

Use local simulator/dev-client work only when it answers a question that tests
cannot answer. Before trying local app runtime:

1. Run the pure logic lane.
2. Run the component lane for the screen or component under change.
3. Run typecheck.
4. Decide what remains observable only in the app runtime.

For simulator work, prefer an explicit Metro port and a direct deep link to the
route under test:

```bash
cd apps/mobile
npx expo run:ios --port 8082
xcrun simctl openurl booted "kanjilearn://<route>"
```

Use a throwaway test account for flows that need auth. Clean it up in the same
session.

Known traps from this project:

- Physical devices may appear offline; simulators are not equivalent for every
  native feature.
- Local `xcodebuild` error 65 with "No Accounts" means Xcode needs a signed-in
  Apple ID, not that the app code is broken.
- `apps/mobile/ios/` is gitignored for EAS purposes; local iOS edits do not
  reach cloud builds.
- A stale Metro bundle can make device reports contradict code. Confirm bundle
  freshness before patching layout.

## What Still Needs Device or TestFlight

Batch these checks. Do not spend one EAS build per judgment.

- TTS voice quality, language switching feel, and output volume
- Haptics
- Real push token registration, receipt polling, and delivered notifications
- App Store / Apple capability behavior
- Physical safe-area, keyboard, scrolling, and small-device layout checks when
  simulator screenshots are inconclusive
- Any flow whose correctness depends on production bundle identifiers or
  TestFlight entitlements

Before any EAS build, run the existing SOP gates, especially:

- API-behind-mobile check for `apps/api` and `packages/shared`
- `EXPO_NO_CAPABILITY_SYNC=1` on every iOS build command
- no manual `ios.buildNumber` bump

## Adoption Rule

For each future feature:

1. Put pure decisions in pure modules and cover them in the logic lane.
2. Add component tests for render states and interaction surfaces.
3. Use simulator/dev-client only for integration observations tests cannot make.
4. Batch physical/TestFlight work into a written walkthrough.
5. Record any new local trap in this document or `docs/SOP.md` before the next
   session loses the lesson.
