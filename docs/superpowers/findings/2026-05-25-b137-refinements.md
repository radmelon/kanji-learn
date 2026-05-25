# B137 — Refinements queued during Phase 1' on-device verification

**Source:** operator feedback while walking B136 (Phase 1' BuddyCard delivery skeleton) on TestFlight, 2026-05-25.

Each item is a deferred refinement — Phase 1' shipped functionally correct; these are placement / UX adjustments to fold into the next build cycle.

---

## 1. BuddyCard placement on Dashboard — move up under "Drill Weak Spots"

**Current placement (B136):** `<BuddyCardStack screen="dashboard" />` is mounted between the Kanji Status card and the Velocity card. See [apps/mobile/app/(tabs)/index.tsx](../../../apps/mobile/app/(tabs)/index.tsx) — search for `{/* ── Buddy nudges ── */}`.

**Requested placement:** higher on the page, directly under the "Drill Weak Spots" button.

**Why the change:** the current placement buries the BuddyCard below status info; the user wants Buddy speaking earlier in the visual flow — right after the primary action affordance, so it's the first piece of conversational content the user sees.

**To implement:** locate the Drill Weak Spots button in `apps/mobile/app/(tabs)/index.tsx`, move the `<BuddyCardStack screen="dashboard" />` JSX block to render immediately after it. Leave the import statement where it is. Confirm visually on TestFlight.

**Related design context:** Phase 1' design spec §4.2 (stacking) and §4.3 (visual treatment) don't pin the exact Dashboard placement — only that the card mounts on Dashboard. This refinement is consistent with the spec.

---

## How to fold these in

When the B137 build cycle starts:
1. Apply each refinement as a small commit on `main`.
2. Confirm visually on the next EAS build (or batch with other B137-bound fixes per the bundling memory note).
3. Delete this file once all items are landed (or move to `findings/` with a `[done]` suffix if you want to keep the history).
