/**
 * Unit tests for computeFadeEdges — the pure decision behind the horizontal
 * scroll-affordance fade on the Milestones badge rows.
 *
 * The mobile harness is ts-jest/node (no react-native), so the fade decision is
 * extracted into this pure helper and the <ScrollFadeRow> component stays thin.
 */
import { computeFadeEdges } from '../../src/components/milestones/scrollFade';

describe('computeFadeEdges', () => {
  it('shows no fade when content fits the viewport', () => {
    expect(computeFadeEdges({ contentWidth: 200, viewportWidth: 300, scrollX: 0 })).toEqual({
      left: false,
      right: false,
    });
  });

  it('shows only the right fade when overflowing and at the start', () => {
    expect(computeFadeEdges({ contentWidth: 600, viewportWidth: 300, scrollX: 0 })).toEqual({
      left: false,
      right: true,
    });
  });

  it('shows both fades when overflowing and scrolled to the middle', () => {
    expect(computeFadeEdges({ contentWidth: 600, viewportWidth: 300, scrollX: 150 })).toEqual({
      left: true,
      right: true,
    });
  });

  it('shows only the left fade when scrolled to the end', () => {
    // scrollX + viewport == content → no more content to the right
    expect(computeFadeEdges({ contentWidth: 600, viewportWidth: 300, scrollX: 300 })).toEqual({
      left: true,
      right: false,
    });
  });

  it('shows no fade before measurement (zero viewport)', () => {
    expect(computeFadeEdges({ contentWidth: 600, viewportWidth: 0, scrollX: 0 })).toEqual({
      left: false,
      right: false,
    });
  });

  it('treats iOS bounce (negative scrollX) as the start — no left fade', () => {
    expect(computeFadeEdges({ contentWidth: 600, viewportWidth: 300, scrollX: -40 })).toEqual({
      left: false,
      right: true,
    });
  });

  it('ignores sub-pixel overflow within the tolerance', () => {
    // 0.5px of overflow should not light up the right fade.
    expect(computeFadeEdges({ contentWidth: 300.5, viewportWidth: 300, scrollX: 0 })).toEqual({
      left: false,
      right: false,
    });
  });
});
