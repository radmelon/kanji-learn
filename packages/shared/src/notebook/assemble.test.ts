import { describe, it, expect } from 'vitest'
import { assembleNotebook } from './assemble'
import type { NotebookInput } from './types'

const base: NotebookInput = {
  cadence: { intervalWeeks: 1, buddyDay: 0 },
  commitments: [], entries: [], tutorNotes: [],
}

const commitment = (weekStart: string, supersededAt: string | null, experimentUntil: string | null = null) => ({
  weekStart, daysCommitted: 4, minutesPerDay: 15, focus: null,
  source: 'session' as const, supersededAt, experimentUntil,
})

const entry = (id: string, kind: 'observation' | 'decision', supersededAt: string | null) => ({
  id, kind, body: `body ${id}`, author: 'buddy' as const,
  createdAt: '2026-08-01T00:00:00Z', editableBy: [] as never[], supersededAt,
})

describe('assembleNotebook', () => {
  it('is empty when nothing has happened yet', () => {
    expect(assembleNotebook(base).isEmpty).toBe(true)
  })

  it('takes the one unsuperseded commitment as the agreement and archives the rest', () => {
    const view = assembleNotebook({
      ...base,
      commitments: [
        commitment('2026-07-20', '2026-07-27T00:00:00Z'),
        commitment('2026-07-27', null),
      ],
    })
    expect(view.agreement?.weekStart).toBe('2026-07-27')
    expect(view.pastAgreements.map((c) => c.weekStart)).toEqual(['2026-07-20'])
  })

  it('surfaces a commitment carrying experimentUntil as the live experiment', () => {
    const view = assembleNotebook({
      ...base,
      commitments: [commitment('2026-07-27', null, '2026-08-03')],
    })
    expect(view.experiment?.weekStart).toBe('2026-07-27')
  })

  it('splits entries into live and archived by section', () => {
    const view = assembleNotebook({
      ...base,
      entries: [
        entry('a', 'observation', null),
        entry('b', 'observation', '2026-07-30T00:00:00Z'),
        entry('c', 'decision', null),
      ],
    })
    const obs = view.sections.find((s) => s.key === 'observations')!
    const settled = view.sections.find((s) => s.key === 'settled')!
    expect(obs.live.map((e) => e.id)).toEqual(['a'])
    expect(obs.archived.map((e) => e.id)).toEqual(['b'])
    expect(settled.live.map((e) => e.id)).toEqual(['c'])
  })

  it('marks buddy entries learner-editable and tutor notes editable by nobody else', () => {
    const view = assembleNotebook({
      ...base,
      entries: [entry('a', 'observation', null)],
      tutorNotes: [{
        shareId: 's1', tutorLabel: 'Ono Kumiko',
        notes: [{ id: 'n1', body: 'がんばって', language: 'ja', translation: null, createdAt: '2026-08-01T00:00:00Z' }],
      }],
    })
    const obs = view.sections.find((s) => s.key === 'observations')!
    expect(obs.live[0].editableBy).toContain('learner')

    const tutor = view.sections.find((s) => s.key === 'tutor')!
    expect(tutor.shareId).toBe('s1')
    expect(tutor.live[0].editableBy).toEqual(['tutor'])
  })

  it('omits the tutor section entirely when there is no accepted share', () => {
    const view = assembleNotebook(base)
    expect(view.sections.find((s) => s.key === 'tutor')).toBeUndefined()
  })

  it('emits one tutor section per share so two tutors never merge', () => {
    const view = assembleNotebook({
      ...base,
      tutorNotes: [
        { shareId: 's1', tutorLabel: 'Ono Kumiko', notes: [] },
        { shareId: 's2', tutorLabel: 'Alex', notes: [] },
      ],
    })
    expect(view.sections.filter((s) => s.key === 'tutor').map((s) => s.shareId)).toEqual(['s1', 's2'])
  })
})
