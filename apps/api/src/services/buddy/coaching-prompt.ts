// apps/api/src/services/buddy/coaching-prompt.ts
//
// The analysis-mode prompt (slice 3 §4). Pure: no I/O, no clock, no service
// dependencies — the same shape as meeting-prompt.ts, deliberately.
//
// What the model receives is fixed by parent §1: findings and their Evidence,
// never a database row. Evidence.label/value are already display-safe, "so the
// voice layer has nothing left to calculate" — the instruction block below is
// the only thing enforcing that, because §10 forbids asserting prose.

import type { Finding } from '@kanji-learn/shared'

export interface CoachingPromptInput {
  openerKind: string
  openerText: string
  /** null when there is no previous period — a first-ever session. */
  reckon: string | null
  findings: readonly Finding[]
}

/**
 * Split the findings into what the LLM may voice and the one kind it may not.
 *
 * §3: mechanics_explainer is "template, always, never LLM. Buddy must not
 * improvise about his own algorithm, so this string is the whole finding."
 * Removing it from the input rather than instructing the model to quote it
 * exactly makes paraphrase structurally impossible instead of
 * instruction-dependent — and §10 forbids the prose assertion that would be
 * the only way to catch a paraphrase.
 *
 * Returns fresh arrays; never mutates the input.
 */
export function partitionForVoice(
  findings: readonly Finding[],
): { spoken: Finding[]; mechanics: Finding | null } {
  const spoken: Finding[] = []
  let mechanics: Finding | null = null
  for (const f of findings) {
    if (f.kind === 'mechanics_explainer') mechanics = f
    else spoken.push(f)
  }
  return { spoken, mechanics }
}

function describe(f: Finding): string {
  const facts = f.evidence.length === 0
    ? 'no specific evidence'
    : f.evidence.map((e) => `${e.label}: ${e.value}`).join('; ')
  const seen = f.since === null ? 'first time' : `first seen ${f.since}`
  return `- ${f.kind} (magnitude ${f.magnitude.toFixed(2)}, confidence ${f.confidence.toFixed(2)}, ${seen}) — ${facts}`
}

export function buildCoachingPrompt(input: CoachingPromptInput): string {
  // Filtered HERE, not by the caller. The invariant then holds regardless of
  // what any future call site passes in.
  const { spoken } = partitionForVoice(input.findings)

  return [
    'You are Buddy, a kanji-learning companion talking to a learner you already know. Honest, warm, brief — four or five sentences, no lists, no headings, no emoji.',
    `Opener (kind: ${input.openerKind}): ${input.openerText}`,
    input.reckon === null
      ? 'Reckoning: none — there is no previous period to look back on.'
      : `Reckoning: ${input.reckon}`,
    'Findings, most important first:',
    spoken.map(describe).join('\n'),
    'Say ONE thing that covers the opener, the reckoning and the findings as a single continuous piece of prose. Not three paragraphs stitched together — one voice.',
    'Every number, level, percentage, date and kanji you use MUST appear verbatim above. Do NOT calculate, re-derive, convert, round or estimate anything, and do not add facts about this learner that are not listed.',
    'Name the specific kanji and the specific next move where the findings give you one — "a handful of kanji" and "this level" are failures.',
    'Reply with the utterance only. No preamble, no quotation marks, no JSON.',
  ].join('\n')
}
