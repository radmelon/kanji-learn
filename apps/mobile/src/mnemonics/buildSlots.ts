import { lookupComponents, type AssemblerSlots, type CoCreationContext, type AssemblyTier } from '@kanji-learn/shared'

export interface KanjiForHook {
  character: string
  meanings: string[]
  kunReadings: string[]
  onReadings: string[]
  components: string[]
}
export interface HookAnswers {
  anchor: string
  locationName: string
  personalDetail?: string
  readingPlay?: string
}

/** kun reading like "も.つ" → kana "もつ"; falls back to the first on-reading. */
function pickReading(k: KanjiForHook): string {
  const kun = k.kunReadings[0]
  if (kun) return kun.replace(/[.\-・]/g, '')
  return k.onReadings[0] ?? ''
}

export function buildSlots(k: KanjiForHook, a: HookAnswers): AssemblerSlots {
  return {
    kanji: k.character,
    kanjiMeaning: k.meanings[0] ?? '',
    reading: pickReading(k),
    components: lookupComponents(k.components),
    locationName: a.locationName,
    anchor: a.anchor,
    personalDetail: a.personalDetail,
    readingPlay: a.readingPlay,
  }
}

export function buildContext(
  k: KanjiForHook,
  a: HookAnswers,
  generatedBy: AssemblyTier,
  quizDueAtIso: string,
): CoCreationContext {
  const mapped = lookupComponents(k.components).map((c) => ({ char: c.char, meaning: c.meaning }))
  const questions = ['Look around — what is one thing that catches your eye?']
  const answers = [a.anchor]
  if (a.personalDetail) { questions.push('A personal detail?'); answers.push(a.personalDetail) }
  if (a.readingPlay) { questions.push('A sound for the reading?'); answers.push(a.readingPlay) }
  return {
    layers: [{ questions, answers, anchor: a.anchor, source: 'environment' }],
    layerCount: 1,
    locationName: a.locationName,
    components: mapped,
    generatedBy,
    mnemonicQuizDueAt: quizDueAtIso,
  }
}
