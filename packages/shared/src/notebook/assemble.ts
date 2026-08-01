import type { NotebookInput, NotebookSection, NotebookView, EntryAuthor } from './types'

const TITLES = {
  observations: 'What Buddy notices',
  settled: "What we've settled",
} as const

export function assembleNotebook(input: NotebookInput): NotebookView {
  const live = input.commitments.filter((c) => c.supersededAt === null)
  const agreement = live[0] ?? null
  const pastAgreements = input.commitments.filter((c) => c.supersededAt !== null)
  const experiment = live.find((c) => c.experimentUntil !== null) ?? null

  const section = (
    key: 'observations' | 'settled',
    kind: 'observation' | 'decision',
  ): NotebookSection => {
    const mine = input.entries.filter((e) => e.kind === kind)
    const withRights = mine.map((e) => ({
      id: e.id, body: e.body, author: e.author,
      createdAt: e.createdAt,
      // Joint authorship: the learner may supersede anything Buddy wrote.
      editableBy: e.author === 'buddy' ? (['learner', 'buddy'] as const).slice() as EntryAuthor[] : ['learner'] as EntryAuthor[],
    }))
    return {
      key, title: TITLES[key],
      live: withRights.filter((_, i) => mine[i].supersededAt === null),
      archived: withRights.filter((_, i) => mine[i].supersededAt !== null),
    }
  }

  const sections: NotebookSection[] = [section('observations', 'observation'), section('settled', 'decision')]

  // One section per share — spec §3. Absent, not empty, when there is no share.
  for (const share of input.tutorNotes) {
    sections.push({
      key: 'tutor', title: `From ${share.tutorLabel}`, shareId: share.shareId,
      live: share.notes.map((n) => ({
        id: n.id, body: n.body, author: 'tutor' as const,
        createdAt: n.createdAt, editableBy: ['tutor' as const],
      })),
      archived: [],
    })
  }

  const isEmpty =
    agreement === null &&
    experiment === null &&
    input.entries.length === 0 &&
    input.tutorNotes.every((s) => s.notes.length === 0)

  return {
    cadence: input.cadence,
    agreement: agreement ? stripMeta(agreement) : null,
    pastAgreements: pastAgreements.map(stripMeta),
    experiment: experiment ? stripMeta(experiment) : null,
    sections,
    tutorNotes: input.tutorNotes,
    isEmpty,
  }
}

function stripMeta<T extends { supersededAt: string | null; experimentUntil: string | null }>(c: T) {
  const { supersededAt: _s, experimentUntil: _e, ...rest } = c
  return rest
}
