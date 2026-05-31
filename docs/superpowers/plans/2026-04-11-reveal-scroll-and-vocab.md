# Reveal Screen: Scroll-Swipe Fix + Vocab Restore — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix vertical scroll in the reveal area triggering swipe grading, and restore vocab words to the reveal screen.

**Architecture:** Two isolated changes in two files. Task 1 modifies the PanResponder `onMoveShouldSetPanResponder` condition in `study.tsx` to require a velocity threshold for vertical gestures. Task 2 re-adds the vocab JSX block to `KanjiCard.tsx`'s answer `ScrollView` — the styles were never removed so only the render code needs restoring.

**Tech Stack:** React Native, Expo, TypeScript, `PanResponder` gesture system

---

## Files

- Modify: `apps/mobile/app/(tabs)/study.tsx` — PanResponder velocity threshold (lines 83–87)
- Modify: `apps/mobile/src/components/study/KanjiCard.tsx` — vocab JSX in answer ScrollView + `exampleVocab` extraction

---

### Task 1: Fix vertical swipe stealing scroll gestures

**Files:**
- Modify: `apps/mobile/app/(tabs)/study.tsx:83-87`

The problem is `onMoveShouldSetPanResponder` claims vertical gestures at only 8px of `dy`. That's so sensitive that normal scrolling inside the answer `ScrollView` fires it. The fix: for vertical direction, require `vy > 0.4` (velocity, not displacement). Slow scrolling has low vy; deliberate swipe-to-grade flicks have high vy. Horizontal detection is unchanged.

- [ ] **Step 1: Apply the fix**

In `apps/mobile/app/(tabs)/study.tsx`, find the `onMoveShouldSetPanResponder` callback (around line 83) and change only the vertical condition:

```ts
// BEFORE (lines 83-87):
onMoveShouldSetPanResponder: (_, gs) =>
  isRevealedRef.current && (
    (Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5 && Math.abs(gs.dx) > 8) ||
    (Math.abs(gs.dy) > Math.abs(gs.dx) * 1.5 && Math.abs(gs.dy) > 8)
  ),

// AFTER:
onMoveShouldSetPanResponder: (_, gs) =>
  isRevealedRef.current && (
    (Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5 && Math.abs(gs.dx) > 8) ||
    (Math.abs(gs.dy) > Math.abs(gs.dx) * 1.5 && Math.abs(gs.vy) > 0.4)
  ),
```

Only the last condition changes: `Math.abs(gs.dy) > 8` → `Math.abs(gs.vy) > 0.4`.

- [ ] **Step 2: Verify on device / simulator**

Test these two scenarios on a revealed card with scrollable content:
1. Slow drag downward on the answer area → card should NOT fly away, content should scroll
2. Fast upward flick anywhere on the card → card should fly off and grade "Good"
3. Fast downward flick → grade "Hard"
4. Left/right swipes still grade "Again" / "Easy" as before

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/(tabs)/study.tsx
git commit -m "fix(study): use velocity threshold for vertical swipe to prevent scroll conflict"
```

---

### Task 2: Restore vocab words to the reveal screen

**Files:**
- Modify: `apps/mobile/src/components/study/KanjiCard.tsx`

The vocab JSX was removed from the answer `ScrollView` in commit `7326010` but the styles (`styles.vocab`, `styles.vocabRow`, `styles.vocabItem`) were left in the stylesheet. Restore the first 2 vocab entries (cap at 2 — the drawer shows all).

- [ ] **Step 1: Extract `exampleVocab` in the component**

In `apps/mobile/src/components/study/KanjiCard.tsx`, inside `KanjiCard` (after the `meanings` and `jlptColor` lines, around line 57–58), add:

```ts
const exampleVocab = (Array.isArray(item.exampleVocab)
  ? item.exampleVocab as { word: string; reading: string; meaning: string }[]
  : []).slice(0, 2)
```

- [ ] **Step 2: Add vocab JSX to the answer ScrollView**

In the same file, in the answer `ScrollView` content (after the closing `</View>` of `readingsBlock`, around line 287), add the vocab section:

```tsx
{/* Example vocab — first 2 entries */}
{exampleVocab.length > 0 && (
  <View style={styles.vocab}>
    {exampleVocab.map((v, i) => (
      <View key={i} style={styles.vocabRow}>
        <Text style={styles.vocabItem}>
          {v.word}【{v.reading}】{'  '}{v.meaning}
        </Text>
      </View>
    ))}
  </View>
)}
```

This re-uses the existing styles and renders each vocab item as `word【reading】  meaning` on a single row. No TTS button (TTS remains in the full details drawer).

- [ ] **Step 3: Verify on device / simulator**

On a revealed card for a kanji that has vocab data:
1. Vocab section appears below the readings block
2. Shows at most 2 vocab entries
3. For kanji with no vocab data, no section appears
4. Full details drawer still shows all vocab (unchanged)

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/study/KanjiCard.tsx
git commit -m "feat(study): restore example vocab to reveal screen (capped at 2)"
```
