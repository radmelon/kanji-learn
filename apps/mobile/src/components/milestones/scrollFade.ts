/**
 * Pure decision for the horizontal scroll-affordance fades on the Milestones
 * badge rows. Kept free of react-native imports so it runs in the ts-jest/node
 * test harness; <ScrollFadeRow> wires the measured layout/scroll values in.
 */
export type FadeEdges = {
  /** Show a fade on the left edge (content scrolled away from the start). */
  left: boolean;
  /** Show a fade on the right edge (more content beyond the right edge). */
  right: boolean;
};

export type FadeEdgesInput = {
  /** Total scrollable content width. */
  contentWidth: number;
  /** Visible viewport width. */
  viewportWidth: number;
  /** Current horizontal scroll offset. */
  scrollX: number;
  /** Sub-pixel tolerance to avoid flicker on fractional overflow. */
  tolerance?: number;
};

export function computeFadeEdges({
  contentWidth,
  viewportWidth,
  scrollX,
  tolerance = 1,
}: FadeEdgesInput): FadeEdges {
  // Not yet measured (or empty): nothing to fade.
  if (viewportWidth <= 0 || contentWidth <= 0) {
    return { left: false, right: false };
  }

  // Content fits — no scroll, no affordance needed.
  if (contentWidth - viewportWidth <= tolerance) {
    return { left: false, right: false };
  }

  // Clamp bounce (negative offset on iOS) so it reads as "at the start".
  const offset = Math.max(0, scrollX);

  return {
    left: offset > tolerance,
    right: offset + viewportWidth < contentWidth - tolerance,
  };
}
