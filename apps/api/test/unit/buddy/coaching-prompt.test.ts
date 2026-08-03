import { describe, it, expect } from 'vitest'
import type { Finding } from '@kanji-learn/shared'
import {
  buildCoachingPrompt,
  partitionForVoice,
} from '../../../src/services/buddy/coaching-prompt'

const leech: Finding = {
  kind: 'leech',
  magnitude: 0.7,
  confidence: 0.8,
  evidence: [
    { label: 'worst kanji', value: '敗', kanjiId: 1, character: '敗' },
    { label: 'lapses', value: 4 },
  ],
  since: '2026-07-12',
}

const mechanics: Finding = {
  kind: 'mechanics_explainer',
  magnitude: 0.1,
  confidence: 1,
  evidence: [],
  since: null,
}

const base = {
  openerKind: 'strong',
  openerText: 'Four days out of four. That is the whole thing working.',
  reckon: 'You said 4 days and did 4.',
  findings: [leech],
}

describe('partitionForVoice', () => {
  // MUTATION CAUGHT: a filter written as `f.kind !== 'mechanics_explainer'`
  // on the spoken side but never returning the removed finding. Task 4 would
  // then have nothing to append and the explainer would vanish from the
  // session entirely — §4 says it is removed from the prompt AND appended.
  it('separates mechanics_explainer from the findings the LLM may voice', () => {
    const { spoken, mechanics: m } = partitionForVoice([leech, mechanics])
    expect(spoken.map((f) => f.kind)).toEqual(['leech'])
    expect(m?.kind).toBe('mechanics_explainer')
  })

  // MUTATION CAUGHT: returning `findings[0]` or a truthy sentinel for
  // mechanics when the kind never fired, which would make Task 4 append a
  // duplicate of a real finding as if it were the explainer.
  it('reports no mechanics finding when the kind did not fire', () => {
    expect(partitionForVoice([leech]).mechanics).toBeNull()
  })

  // MUTATION CAUGHT: filtering in place with `.splice`/sort, mutating the
  // caller's array. The route reuses `findings` for analysisBody afterwards;
  // a mutated array would silently drop the explainer from the template
  // fallback too.
  it('does not mutate the input array', () => {
    const input = [leech, mechanics]
    partitionForVoice(input)
    expect(input.map((f) => f.kind)).toEqual(['leech', 'mechanics_explainer'])
  })
})

describe('buildCoachingPrompt', () => {
  // MUTATION CAUGHT: the whole point of §4. If a later refactor passes the
  // unfiltered list, or someone "simplifies" buildCoachingPrompt to trust its
  // caller, Buddy starts paraphrasing his own IRT internals and §10 forbids
  // the prose test that would otherwise notice.
  it('never mentions mechanics_explainer, even when handed it directly', () => {
    const prompt = buildCoachingPrompt({ ...base, findings: [leech, mechanics] })
    expect(prompt).not.toContain('mechanics_explainer')
    expect(prompt).not.toContain('IRT')
  })

  // MUTATION CAUGHT: serialising only `kind`, which is exactly the defect the
  // slice 2 retrospective found in templateCopy — the evidence exists and the
  // copy layer never reads it. The model cannot name 敗 if it is not sent 敗.
  it('carries each finding kind and its evidence labels and values', () => {
    const prompt = buildCoachingPrompt(base)
    expect(prompt).toContain('leech')
    expect(prompt).toContain('worst kanji')
    expect(prompt).toContain('敗')
    expect(prompt).toContain('lapses')
    expect(prompt).toContain('4')
  })

  // MUTATION CAUGHT: dropping the opener or reckoning from the input, which
  // would leave the model composing from findings alone and produce an
  // utterance that ignores what the learner actually did last period.
  it('carries the opener and the reckoning', () => {
    const prompt = buildCoachingPrompt(base)
    expect(prompt).toContain(base.openerText)
    expect(prompt).toContain(base.reckon)
  })

  // MUTATION CAUGHT: interpolating a null reckon as the string "null", which
  // a first-ever-session learner would get, telling the model to relay the
  // literal word.
  it('says there is no reckoning rather than printing null', () => {
    const prompt = buildCoachingPrompt({ ...base, reckon: null })
    expect(prompt).not.toContain('null')
    expect(prompt.toLowerCase()).toContain('no previous period')
  })

  // MUTATION CAUGHT: dropping the do-not-calculate instruction. Parent §1
  // makes "the voice layer has nothing left to calculate" load-bearing: a
  // model that recomputes a percentage can contradict the notebook, and no
  // test may assert prose, so this instruction is the only defence.
  it('forbids recomputing numbers', () => {
    const prompt = buildCoachingPrompt(base).toLowerCase()
    expect(prompt).toContain('do not')
    expect(prompt).toContain('calculate')
  })

  // MUTATION CAUGHT: copying meeting-prompt.ts wholesale, JSON envelope and
  // all. §4 asks for plain prose — a JSON wrapper adds a parse-failure mode
  // for nothing, and Task 4 would return a raw `{"reply": …}` blob as Buddy's
  // words.
  it('asks for plain prose, not JSON', () => {
    const prompt = buildCoachingPrompt(base)
    expect(prompt).not.toContain('JSON object')
    expect(prompt.toLowerCase()).toContain('no json')
  })

  // MUTATION CAUGHT: emitting three labelled sections instead of asking for
  // one composed utterance — §3's whole reason for existing.
  it('asks for a single utterance', () => {
    expect(buildCoachingPrompt(base).toLowerCase()).toContain('one thing')
  })
})
