import type { AssemblyTier } from '@kanji-learn/shared'
import type { KanjiForHook } from './buildSlots'

export type Stage = 'consent' | 'location_inference' | 'detail_elicitation' | 'assembly' | 'commitment'

export interface CoCreationState {
  kanji: KanjiForHook
  stage: Stage
  locationName?: string
  latitude?: number
  longitude?: number
  anchor?: string
  personalDetail?: string
  readingPlay?: string
  draft?: string
  generatedBy?: AssemblyTier
  mnemonicId?: string
  assembling: boolean
  saving: boolean
  error?: string
}

export type Action =
  | { type: 'ACCEPT' }
  | { type: 'LOCATION_SET'; name: string; latitude?: number; longitude?: number }
  | { type: 'LOCATION_CONFIRM' }
  | { type: 'LOCATION_TEXT'; name: string }
  | { type: 'ANCHOR_SET'; anchor: string }
  | { type: 'ASSEMBLING' }
  | { type: 'DRAFT_READY'; storyText: string; generatedBy: AssemblyTier }
  | { type: 'STICKIER'; personalDetail?: string; readingPlay?: string }
  | { type: 'SAVING' }
  | { type: 'COMMITTED'; mnemonicId: string }
  | { type: 'ERROR'; message: string }

export const initialCoCreation = (kanji: KanjiForHook): CoCreationState => ({
  kanji, stage: 'consent', assembling: false, saving: false,
})

export function coCreationReducer(s: CoCreationState, a: Action): CoCreationState {
  switch (a.type) {
    case 'ACCEPT': return { ...s, stage: 'location_inference' }
    // Stays on location_inference on purpose. It used to advance to
    // detail_elicitation in the same action, which is why the grant path never
    // rendered "Looks like you're near X" — by the time locationName existed,
    // the stage that displays it was already gone. The learner confirms, which
    // is also their chance to say "somewhere else".
    case 'LOCATION_SET': return { ...s, locationName: a.name, latitude: a.latitude, longitude: a.longitude }
    case 'LOCATION_CONFIRM': return { ...s, stage: 'detail_elicitation' }
    // Typed location: no coordinates, and clear any inferred ones — the
    // learner has just told us the GPS answer was not where they mean.
    case 'LOCATION_TEXT': return { ...s, stage: 'detail_elicitation', locationName: a.name, latitude: undefined, longitude: undefined }
    case 'ANCHOR_SET': return { ...s, stage: 'assembly', anchor: a.anchor }
    case 'ASSEMBLING': return { ...s, assembling: true, error: undefined }
    case 'DRAFT_READY': return { ...s, assembling: false, draft: a.storyText, generatedBy: a.generatedBy }
    case 'STICKIER': return { ...s, personalDetail: a.personalDetail ?? s.personalDetail, readingPlay: a.readingPlay ?? s.readingPlay }
    case 'SAVING': return { ...s, saving: true, error: undefined }
    case 'COMMITTED': return { ...s, saving: false, stage: 'commitment', mnemonicId: a.mnemonicId }
    case 'ERROR': return { ...s, assembling: false, saving: false, error: a.message }
    default: return s
  }
}
