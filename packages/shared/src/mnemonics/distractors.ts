export interface DistractorKanji {
  kanjiId: number
  radicals: string[]
  jlpt: number
}

/**
 * Picks up to `count` distractor kanjiIds for a story→kanji quiz.
 * Priority: shares a radical with the target → same JLPT level → anything.
 * Deterministic: preserves pool order within each tier; no RNG.
 */
export function selectDistractors(
  target: DistractorKanji,
  pool: DistractorKanji[],
  count: number,
): number[] {
  const targetRadicals = new Set(target.radicals)
  const candidates = pool.filter((k) => k.kanjiId !== target.kanjiId)

  const sharesRadical = (k: DistractorKanji) => k.radicals.some((r) => targetRadicals.has(r))

  const tier1 = candidates.filter(sharesRadical)
  const tier2 = candidates.filter((k) => !sharesRadical(k) && k.jlpt === target.jlpt)
  const tier3 = candidates.filter((k) => !sharesRadical(k) && k.jlpt !== target.jlpt)

  const ordered: number[] = []
  for (const k of [...tier1, ...tier2, ...tier3]) {
    if (ordered.length >= count) break
    if (!ordered.includes(k.kanjiId)) ordered.push(k.kanjiId)
  }
  return ordered
}
