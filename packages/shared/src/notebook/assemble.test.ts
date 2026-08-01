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

const commitmentWithSource = (source: 'session' | 'rolled_forward' | 'default') => ({
  weekStart: '2026-07-27', daysCommitted: 4, minutesPerDay: 15, focus: null,
  source, supersededAt: null, experimentUntil: null,
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

  it('does not treat a default-seeded commitment as an agreement the learner made', () => {
    const view = assembleNotebook({
      ...base,
      commitments: [commitmentWithSource('default')],
    })
    expect(view.agreement).toBeNull()
  })

  it('does treat a rolled-forward commitment as a real agreement', () => {
    const view = assembleNotebook({
      ...base,
      commitments: [commitmentWithSource('rolled_forward')],
    })
    expect(view.agreement).not.toBeNull()
    expect(view.agreement?.weekStart).toBe('2026-07-27')
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

  it('marks buddy entries learner-editable; tutor notes surface only through view.tutorNotes, never sections', () => {
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

    // Nobody but the tutor may supersede a tutor note. TutorNoteView has no
    // `editableBy` field at all — unlike a NotebookSection's `live` entries,
    // it structurally cannot be routed through the generic supersede path.
    // A tutor section in `sections` would be exactly that path, wired to
    // `onEdit`, so it must never appear there.
    expect(view.sections.find((s) => s.key === 'tutor')).toBeUndefined()
    expect(view.tutorNotes).toHaveLength(1)
    expect(view.tutorNotes[0].shareId).toBe('s1')
    expect(view.tutorNotes[0].notes[0].body).toBe('がんばって')
  })

  it('omits tutor notes entirely when there is no accepted share', () => {
    const view = assembleNotebook(base)
    expect(view.tutorNotes).toEqual([])
    expect(view.sections.find((s) => s.key === 'tutor')).toBeUndefined()
  })

  it('emits one tutorNotes entry per share so two tutors never merge, and never a tutor section', () => {
    const view = assembleNotebook({
      ...base,
      tutorNotes: [
        { shareId: 's1', tutorLabel: 'Ono Kumiko', notes: [] },
        { shareId: 's2', tutorLabel: 'Alex', notes: [] },
      ],
    })
    expect(view.tutorNotes.map((s) => s.shareId)).toEqual(['s1', 's2'])
    expect(view.sections.filter((s) => s.key === 'tutor')).toHaveLength(0)
  })
})
