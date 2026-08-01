import { z } from 'zod'

/** Zod mirror of @kanji-learn/shared ExtractedPatch. .strict() so a
 *  hallucinated key is a rejection, not a silent pass-through. */
export const extractedPatchSchema = z
  .object({
    reasons: z.array(z.string().min(1).max(80)).max(8).optional(),
    interests: z.array(z.string().min(1).max(80)).max(8).optional(),
    explicitRuler: z.enum(['jlpt', 'grade']).optional(),
    dailyGoal: z.number().int().min(5).max(200).optional(),
    buddyDay: z.number().int().min(0).max(6).optional(),
    buddyIntervalWeeks: z.number().int().min(1).max(2).optional(),
  })
  .strict()

/** Tolerant first-object extractor: strips fences, takes outermost braces. */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const stripped = text.replace(/```(?:json)?/g, '')
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const value: unknown = JSON.parse(stripped.slice(start, end + 1))
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}
