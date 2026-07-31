export interface SessionCommitment {
  weekStart: string
  daysCommitted: number
  dayTargets: number[] | null
  minutesPerDay: number
  focus: string | null
  source: 'session' | 'rolled_forward' | 'default'
}

export type SessionData =
  | { state: 'not_scheduled' }
  | { state: 'waiting'; nextDue: string }
  | {
      state: 'due'
      weekStart: string
      opener: { kind: string; text: string }
      reckon: string | null
      isFirstSession: boolean
      proposedCommitment: SessionCommitment
    }

export type SessionCard =
  | { kind: 'opener'; text: string }
  | { kind: 'reckon'; text: string }
  | { kind: 'set'; proposed: SessionCommitment }

export type SessionBody =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'not_scheduled' }
  | { kind: 'waiting'; nextDue: string }
  | { kind: 'cards'; cards: SessionCard[] }

export function selectSessionBody(
  input: { hasLoaded: boolean; error: string | null; data: SessionData | null }
): SessionBody {
  if (!input.hasLoaded) return { kind: 'loading' }

  if (input.error !== null) return { kind: 'error' }

  // Loaded, no error, and still no data is a real state — and it is the exact
  // shape of B-227, where the Journal rendered nothing on a cold load and the
  // owner concluded the feature had never been built. Surfacing an error beats
  // falling through to a blank screen.
  if (input.data === null) return { kind: 'error' }

  switch (input.data.state) {
    case 'not_scheduled':
      return { kind: 'not_scheduled' }
    case 'waiting':
      return { kind: 'waiting', nextDue: input.data.nextDue }
    case 'due': {
      const cards: SessionCard[] = []

      cards.push({ kind: 'opener', text: input.data.opener.text })

      if (input.data.reckon !== null) {
        cards.push({ kind: 'reckon', text: input.data.reckon })
      }

      // The 'set' card is unconditional and always last: agreeing the coming
      // week is the session's one guaranteed outcome, so it survives a learner
      // who bails early and is never displaced by anything above it.
      cards.push({ kind: 'set', proposed: input.data.proposedCommitment })

      return { kind: 'cards', cards }
    }
  }
}
