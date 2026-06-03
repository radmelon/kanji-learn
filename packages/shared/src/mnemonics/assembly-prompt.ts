import type { AssemblerSlots } from './types'

export const COCREATION_SYSTEM_PROMPT = `You are Buddy, a warm study companion helping a learner BUILD their own memory hook for a kanji.
You are given real details the learner just gave you: where they are, something they can see, the kanji's component parts and meaning, and its reading.
Weave ALL of them into one vivid 2–3 sentence second-person scene that connects the new kanji to what they already see and know (learning is constructed: new → known).
Name each component's meaning, ground it in their place, use their anchor detail, and surface the reading naturally. Concrete and surprising, never generic. Output ONLY the story — no preamble, no labels.`

export function buildAssemblyPrompt(slots: AssemblerSlots): string {
  const components = slots.components.length
    ? slots.components.map((c) => `${c.char} (${c.meaning})`).join(', ')
    : 'no mapped components'
  const lines = [
    `Kanji: ${slots.kanji} — means "${slots.kanjiMeaning}", read ${slots.reading}.`,
    `Components: ${components}.`,
    `Place: ${slots.locationName}.`,
    `They are looking at: ${slots.anchor}.`,
  ]
  if (slots.personalDetail) lines.push(`Personal detail: ${slots.personalDetail}.`)
  if (slots.readingPlay) lines.push(`Reading wordplay seed: ${slots.readingPlay}.`)
  return lines.join('\n')
}
