# Reveal Screen: Scroll-Swipe Conflict Fix + Vocab Restore

**Date:** 2026-04-11  
**Build context:** Build 102 — after Option D card redesign (commit 7326010)

---

## Problem Summary

Two issues on the study card reveal screen:

1. **Scroll triggers grading:** Scrolling down to read the details panel (readings, etc.) in the revealed `ScrollView` fires the swipe-down → "Hard" grade evaluation. The `PanResponder` in `study.tsx` claims vertical gestures at only 8px of `dy` movement, which normal scrolling easily crosses.

2. **Vocab words missing:** Example vocab words were removed from the reveal screen in the Option D redesign (commit 7326010). They were moved to the full details drawer. Users want them visible on the reveal screen without needing to open the drawer.

---

## Design

### Fix 1: Velocity-gated vertical swipe detection

**File:** `apps/mobile/app/(tabs)/study.tsx`  
**Location:** `onMoveShouldSetPanResponder` (lines 83–87)

Change the vertical direction check from a displacement threshold (`dy > 8`) to a velocity threshold (`vy > 0.4`):

```
// Before:
Math.abs(gs.dy) > Math.abs(gs.dx) * 1.5 && Math.abs(gs.dy) > 8

// After:
Math.abs(gs.dy) > Math.abs(gs.dx) * 1.5 && Math.abs(gs.vy) > 0.4
```

**Why this works:**
- Slow scroll → `vy` stays below threshold → PanResponder yields → `ScrollView` handles it
- Deliberate swipe flick → `vy` spikes quickly → PanResponder claims → grade fires
- Horizontal swipe detection is unchanged (no scroll conflict there)

**Threshold rationale:** `0.4 px/ms` (~400 px/s) cleanly separates casual scrolling from intentional swipe-to-grade. If testing shows edge cases, it can be tuned ±0.1.

---

### Fix 2: Restore vocab words to reveal screen

**File:** `apps/mobile/src/components/study/KanjiCard.tsx`  
**Location:** Answer `ScrollView` content area (after readings block, line ~287)

Add a vocab section showing the first 2 entries from `item.exampleVocab`:

- Display format: `word【reading】` on one line, `meaning` below it
- Capped at 2 entries (same as pre-redesign behavior)
- No TTS buttons on the card (full TTS remains in the details drawer)
- Guard with `Array.isArray` (same pattern as `exampleVocab` in `RevealAllDrawer`)
- Section label: "vocab" in the same style as "kun" / "on" reading labels, or a subtle separator text

**Styles needed** (add to KanjiCard stylesheet):
- `vocabSection` — top margin separator from readings block
- `vocabRow` — row per word
- `vocabWord` — kanji word text (accent color, slightly larger)  
- `vocabReading` — furigana reading (muted)
- `vocabMeaning` — English meaning (secondary text)

---

## Out of Scope

- Restoring TTS buttons on the card reveal vocab (TTS available in drawer)
- Restoring example sentences to the card reveal (drawer only)
- Changing horizontal swipe behavior
