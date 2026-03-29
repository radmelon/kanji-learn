import { useState, useEffect } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KanjiStroke {
  index: number   // 1-based stroke number
  d: string       // SVG path data
}

export interface KanjiStrokesResult {
  strokes: KanjiStroke[]
  isLoading: boolean
  error: string | null
}

// ─── Cache ────────────────────────────────────────────────────────────────────
// Memoize fetched SVGs for the session so navigating between kanji is instant.

const cache = new Map<string, KanjiStroke[]>()

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useKanjiStrokes(character: string): KanjiStrokesResult {
  const [strokes, setStrokes] = useState<KanjiStroke[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!character) return

    const hex = character.codePointAt(0)!.toString(16).padStart(5, '0')

    // Return from cache instantly
    if (cache.has(hex)) {
      setStrokes(cache.get(hex)!)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    const url = `https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/${hex}.svg`

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`KanjiVG: ${res.status} for ${character}`)
        return res.text()
      })
      .then((svg) => {
        const parsed = parseStrokes(svg)
        cache.set(hex, parsed)
        setStrokes(parsed)
        setIsLoading(false)
      })
      .catch((err) => {
        setError(err.message ?? 'Failed to load stroke order')
        setIsLoading(false)
      })
  }, [character])

  return { strokes, isLoading, error }
}

// ─── Parser ───────────────────────────────────────────────────────────────────
// KanjiVG stroke paths have IDs like kvg:04e09-s1, kvg:04e09-s2, ...
// Extract them in document order (= correct stroke order).

function parseStrokes(svg: string): KanjiStroke[] {
  const results: KanjiStroke[] = []
  // Match stroke path elements by their sequential ID pattern
  const re = /id="kvg:[0-9a-f]+-s(\d+)"[^>]*d="([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(svg)) !== null) {
    results.push({ index: parseInt(m[1], 10), d: m[2] })
  }
  // Sort by index just in case they appear out of order in the SVG
  results.sort((a, b) => a.index - b.index)
  return results
}
