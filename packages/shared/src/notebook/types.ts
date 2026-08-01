export type EntryAuthor = 'buddy' | 'learner' | 'tutor'

export interface NotebookEntry {
  id: string
  body: string
  author: EntryAuthor
  createdAt: string
  /** Tutor entries are unsupersedable by anyone else (spec §4). */
  editableBy: EntryAuthor[]
}

export interface CommitmentView {
  weekStart: string
  daysCommitted: number
  minutesPerDay: number
  focus: string | null
  source: 'session' | 'rolled_forward' | 'default'
}

export interface TutorNoteView {
  id: string
  body: string
  language: string
  /** Present only if the learner explicitly asked for one. */
  translation: string | null
  createdAt: string
}

export interface NotebookSection {
  key: 'agreement' | 'experiment' | 'observations' | 'settled' | 'tutor' | 'hooks'
  title: string
  /** Per-share for tutor sections; undefined elsewhere. */
  shareId?: string
  live: NotebookEntry[]
  archived: NotebookEntry[]
}

export interface NotebookView {
  cadence: { intervalWeeks: number; buddyDay: number | null }
  agreement: CommitmentView | null
  pastAgreements: CommitmentView[]
  experiment: CommitmentView | null
  sections: NotebookSection[]
  tutorNotes: { shareId: string; tutorLabel: string; notes: TutorNoteView[] }[]
  isEmpty: boolean
}

export interface NotebookInput {
  cadence: { intervalWeeks: number; buddyDay: number | null }
  commitments: (CommitmentView & { supersededAt: string | null; experimentUntil: string | null })[]
  entries: (NotebookEntry & { kind: 'observation' | 'decision'; supersededAt: string | null })[]
  tutorNotes: { shareId: string; tutorLabel: string; notes: TutorNoteView[] }[]
}
