// The Frame from the Arc design (docs/superpowers/specs/2026-07-28-new-learner-arc-design.md
// §resolveFrame). Leaf module: milestones/selection.ts imports from here, never
// the reverse.

export type Ruler = 'jlpt' | 'grade'

export type FrameResolution =
  | { kind: 'chosen'; ruler: Ruler }
  | { kind: 'inferred'; ruler: Ruler; from: string[] }
  | { kind: 'ask' }

const JLPT_NEEDLES = ['jlpt', 'work', 'business']
const GRADE_NEEDLES = ['heritage', 'curiosity']

function hits(reasons: string[], needles: string[]): string[] {
  return (reasons ?? []).filter((r) =>
    needles.some((n) => r.toLowerCase().trim().includes(n)),
  )
}

export function resolveFrame(input: {
  explicitRuler?: Ruler | null
  reasons: string[]
}): FrameResolution {
  if (input.explicitRuler) return { kind: 'chosen', ruler: input.explicitRuler }
  const jlpt = hits(input.reasons, JLPT_NEEDLES)
  const grade = hits(input.reasons, GRADE_NEEDLES)
  if (jlpt.length > 0 && grade.length === 0) return { kind: 'inferred', ruler: 'jlpt', from: jlpt }
  if (grade.length > 0 && jlpt.length === 0) return { kind: 'inferred', ruler: 'grade', from: grade }
  return { kind: 'ask' }
}
