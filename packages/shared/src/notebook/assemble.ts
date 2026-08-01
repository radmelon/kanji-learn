import type { NotebookInput, NotebookSection, NotebookView, EntryAuthor } from './types'

const TITLES = {
  observations: 'What Buddy notices',
  settled: "What we've settled",
} as const

export function assembleNotebook(input: NotebookInput): NotebookView {
  const live = input.commitments.filter((c) => c.supersededAt === null)
  // 'default' means seeded with no prior — the learner agreed nothing, so it
  // must never render as "THIS WEEK". 'rolled_forward' IS a real commitment
  // carried over from a previous session and does count.
  const agreementCandidate = live[0] ?? null
  const agreement = agreementCandidate?.source === 'default' ? null : agreementCandidate
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

  // Tutor notes surface ONLY through `tutorNotes` below, never as a
  // `sections` entry. `NotebookEntry.editableBy` exists so the generic
  // supersede path (NotebookBody's onEdit -> PATCH /notebook/entries/:id)
  // knows who may edit a row; a tutor-authored `sections` entry would be
  // wired to that same Pressable and PATCH path, and nobody but the tutor
  // may supersede a tutor note (spec §4). `TutorNoteView` carries no
  // `editableBy` at all, which is what makes that structurally impossible
  // once it stays out of `sections`.

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
