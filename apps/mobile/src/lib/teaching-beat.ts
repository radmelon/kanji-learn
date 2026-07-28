import { lookupComponents } from '@kanji-learn/shared'
import type { KanjiForHook } from '../mnemonics/buildSlots'

/**
 * "扌 (hand) beside 寺 (temple)" style teaching beat.
 *
 * B-217: unmapped components used to render the literal string "this part",
 * which reads as a broken template — *"説 is 言 (speech) beside this part."*
 * It was not an edge case: the radical dictionary holds 20 entries, and 2,166
 * of the 2,187 kanji with components (99%) have at least one component outside
 * it, so the placeholder was the default rendering. It reads worst when the
 * unmapped component comes last, because "beside this part" then has no
 * referent at all.
 *
 * Falling back to the glyph itself is strictly better — we may not know 兑's
 * meaning, but we know its shape, and the learner is looking straight at it.
 * Discarding it threw away information we already had.
 *
 * Lives here rather than in CoCreationSheet.tsx because jest runs in a node
 * environment with no JSX transform, so anything imported from a .tsx is
 * untestable in this repo.
 */
export function teachingBeat(kanji: KanjiForHook): string {
  const mapped = lookupComponents(kanji.components)
  const parts = kanji.components.map((c) => {
    const entry = mapped.find((m) => m.char === c)
    return entry ? `${entry.char} (${entry.meaning})` : c
  })
  if (parts.length === 0) return ''
  if (parts.length === 1) return `${kanji.character} is ${parts[0]}.`
  return `${kanji.character} is ${parts.slice(0, -1).join(', ')} beside ${parts[parts.length - 1]}.`
}
