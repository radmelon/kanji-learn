import { useReducer, useCallback } from 'react'
import { coCreationReducer, initialCoCreation } from './useCoCreation.reducer'
import { buildSlots, buildContext, type KanjiForHook, type HookAnswers } from './buildSlots'
import { assembleStory } from './assembleStory'
import { saveCoCreated } from './cocreationApi'
import { getPlaceName } from './locationName'

export * from './useCoCreation.reducer'

/** Dependency seams so the hook's async effects are mockable. */
export interface CoCreationDeps {
  assemble: typeof assembleStory
  save: typeof saveCoCreated
  getPlace: typeof getPlaceName
  nowIso: () => string
}
const defaultDeps: CoCreationDeps = { assemble: assembleStory, save: saveCoCreated, getPlace: getPlaceName, nowIso: () => new Date().toISOString() }

export function useCoCreation(kanji: KanjiForHook, kanjiId: number, deps: CoCreationDeps = defaultDeps) {
  const [state, dispatch] = useReducer(coCreationReducer, kanji, initialCoCreation)

  const accept = useCallback(async () => {
    dispatch({ type: 'ACCEPT' })
    const place = await deps.getPlace()
    if (place) dispatch({ type: 'LOCATION_SET', name: place.name, latitude: place.latitude, longitude: place.longitude })
    // else: stay in location_inference; the sheet shows a "Where are you?" text input → setLocationText
  }, [deps])

  const setLocationText = useCallback((name: string) => dispatch({ type: 'LOCATION_TEXT', name }), [])

  const submitAnchor = useCallback(async (anchor: string, extra?: { personalDetail?: string; readingPlay?: string }) => {
    dispatch({ type: 'ANCHOR_SET', anchor })
    if (extra) dispatch({ type: 'STICKIER', ...extra })
    dispatch({ type: 'ASSEMBLING' })
    try {
      const a: HookAnswers = { anchor, locationName: state.locationName ?? 'where you are', personalDetail: extra?.personalDetail, readingPlay: extra?.readingPlay }
      const { storyText, generatedBy } = await deps.assemble(buildSlots(kanji, a))
      dispatch({ type: 'DRAFT_READY', storyText, generatedBy })
    } catch (e) {
      dispatch({ type: 'ERROR', message: String(e) })
    }
  }, [deps, kanji, state.locationName])

  const commit = useCallback(async () => {
    if (!state.draft || !state.generatedBy || !state.anchor) return
    dispatch({ type: 'SAVING' })
    try {
      const answers: HookAnswers = { anchor: state.anchor, locationName: state.locationName ?? 'where you are', personalDetail: state.personalDetail, readingPlay: state.readingPlay }
      const ctx = buildContext(kanji, answers, state.generatedBy, deps.nowIso())
      const saved = await deps.save(kanjiId, { storyText: state.draft, context: ctx, latitude: state.latitude, longitude: state.longitude })
      dispatch({ type: 'COMMITTED', mnemonicId: saved.id })
    } catch (e) {
      dispatch({ type: 'ERROR', message: String(e) })
    }
  }, [deps, kanji, kanjiId, state])

  return { state, accept, setLocationText, submitAnchor, commit }
}
