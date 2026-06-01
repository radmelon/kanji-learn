import type { RadicalEntry } from './types'

/**
 * radical char → { name, meaning, imageKeyword }.
 * `name` is the precise Japanese 部首名 for each form — standalone vs side-variant
 * forms get their own names (e.g. 人 'hito' vs 亻 'ninben'; 水 'mizu' vs 氵 'sanzui').
 * These are informed by, but intentionally more precise than, the conflated entries in
 * apps/mobile/src/constants/radicals.ts. `meaning` + `imageKeyword` are added for
 * teaching + mnemonic assembly. Seeded with high-frequency radicals (N5-first); extend
 * toward Kangxi-214, guarded by radical-dictionary.test.ts coverage assertions.
 */
export const RADICAL_DICTIONARY: Record<string, RadicalEntry> = {
  '人': { char: '人', name: 'hito',       meaning: 'person',  imageKeyword: 'a person walking by' },
  '亻': { char: '亻', name: 'ninben',     meaning: 'person',  imageKeyword: 'a person standing at your side' },
  '扌': { char: '扌', name: 'tehen',      meaning: 'hand',    imageKeyword: 'a hand reaching out, grasping' },
  '手': { char: '手', name: 'te',         meaning: 'hand',    imageKeyword: 'an open hand held up' },
  '寺': { char: '寺', name: 'tera',       meaning: 'temple',  imageKeyword: 'a small temple tucked nearby' },
  '水': { char: '水', name: 'mizu',       meaning: 'water',   imageKeyword: 'water flowing past' },
  '氵': { char: '氵', name: 'sanzui',     meaning: 'water',   imageKeyword: 'three droplets of water on the left' },
  '木': { char: '木', name: 'ki',         meaning: 'tree',    imageKeyword: 'a tree rooted in place' },
  '火': { char: '火', name: 'hi',         meaning: 'fire',    imageKeyword: 'a small fire crackling' },
  '日': { char: '日', name: 'nichi',      meaning: 'sun',     imageKeyword: 'the sun overhead' },
  '月': { char: '月', name: 'tsuki',      meaning: 'moon',    imageKeyword: 'a pale moon' },
  '口': { char: '口', name: 'kuchi',      meaning: 'mouth',   imageKeyword: 'an open mouth' },
  '心': { char: '心', name: 'kokoro',     meaning: 'heart',   imageKeyword: 'a beating heart' },
  '忄': { char: '忄', name: 'risshinben', meaning: 'heart',   imageKeyword: 'a heart standing on the left' },
  '土': { char: '土', name: 'tsuchi',     meaning: 'earth',   imageKeyword: 'a mound of earth' },
  '女': { char: '女', name: 'onna',       meaning: 'woman',   imageKeyword: 'a woman seated' },
  '子': { char: '子', name: 'ko',         meaning: 'child',   imageKeyword: 'a small child' },
  '目': { char: '目', name: 'me',         meaning: 'eye',     imageKeyword: 'a watchful eye' },
  '糸': { char: '糸', name: 'ito',        meaning: 'thread',  imageKeyword: 'a length of thread' },
  '言': { char: '言', name: 'gonben',     meaning: 'speech',  imageKeyword: 'words spoken aloud' },
}

/** Resolves component chars to dictionary entries, dropping any that are not mapped. */
export function lookupComponents(chars: string[]): RadicalEntry[] {
  return chars.map((c) => RADICAL_DICTIONARY[c]).filter((e): e is RadicalEntry => e !== undefined)
}
