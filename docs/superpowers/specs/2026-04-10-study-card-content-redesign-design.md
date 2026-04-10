# Study Card Content Redesign — Design Spec
**Date:** 2026-04-10
**Status:** Approved

## Problem

The KanjiCard revealed side has 4-directional swipe gestures (← Again, → Easy, ↑ Good, ↓ Hard). React Native's `PanResponder` intercepts vertical touch events at the native level, preventing the inner `ScrollView` from receiving them. As a result, content below the fold — stroke order, references, example vocab, example sentences, and the Full Details button — is unreachable during a study session.

## Solution (Option D)

Eliminate the scroll problem at its source: reduce the revealed card to only the content needed for grading, and move all reference/enrichment content into an expanded Full Details modal. A magnifying glass icon replaces the scroll-to-reach "Full Details" button.

## Scope

**In scope:** `KanjiCard` component and the Full Details modal only.
**Out of scope:** `CompoundCard` (deferred — user has not yet reached the SRS stage where these appear), swipe gestures, footer grade buttons, header controls.

---

## Architecture

No structural changes to the study screen, gesture system, or grade flow. All changes are confined to:

1. `apps/mobile/src/components/study/KanjiCard.tsx` — remove content sections, add icon
2. The Full Details modal (currently triggered by the "Full Details" text button in `KanjiCard`) — expand its content sections and remove the cap on vocab/sentence items

---

## KanjiCard — Revealed Side (After)

### Removed
- Example vocab section (previously capped at 2 items)
- Example sentences section (previously capped at 2 items)
- Stroke order animation section
- References panel (Nelson Classic, New Nelson, Morohashi, stroke count)
- "Full Details" text button

### Retained
- Meanings
- Readings (kun/on with TTS buttons)
- Rōmaji toggle (top-left, revealed-only — already functional)

### Added
- **Magnifying glass icon** (`search` from Ionicons, ~22px)
  - Positioned: absolutely, bottom-left corner of the kanji character container
  - Visible: only on the revealed side; fades in as part of the reveal animation
  - Color: `colors.textMuted` at rest
  - Action: opens the Full Details modal (same target as the former text button)

**Expected result:** Meanings and readings fit on screen without scrolling for the vast majority of kanji. The `PanResponder`/`ScrollView` conflict becomes a non-issue in practice.

---

## Full Details Modal — Content (After)

The modal becomes the single authoritative reference view for a kanji. Sections in order:

1. All meanings (numbered list)
2. All readings (kun + on)
3. All radicals
4. Example vocab — **uncapped** (previously limited to 2 on the card)
5. Example sentences — **uncapped** (previously limited to 2 on the card)
6. Stroke order animation (full size)
7. Reference indices (stroke count, Nelson Classic, New Nelson, Morohashi)

The modal shell, navigation, and styling are unchanged.

---

## What Is Not Changing

| Element | Status |
|---|---|
| Swipe gestures (← → ↑ ↓) | Unchanged |
| Swipe hint text in footer | Unchanged |
| GradeButtons (Again / Hard / Good / Easy) | Unchanged |
| Header controls (close, progress bar, undo) | Unchanged |
| Rōmaji toggle behavior | Unchanged |
| CompoundCard | Unchanged |
| Full Details modal shell / presentation style | Unchanged |

---

## Open Questions

None — all design decisions resolved during brainstorm.
