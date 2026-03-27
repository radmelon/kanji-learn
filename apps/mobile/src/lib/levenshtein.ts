/**
 * Levenshtein distance — used for near-match voice evaluation.
 * Distance ≤ 2 after wanakana normalization = pass.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length

  if (m === 0) return n
  if (n === 0) return m

  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
      }
    }
  }

  return dp[m][n]
}

/**
 * Near-match check: normalize both strings with wanakana then
 * compute Levenshtein. Returns { distance, passed }.
 */
export function evaluateReading(
  transcript: string,
  expected: string,
  threshold = 2
): { distance: number; passed: boolean; normalizedTranscript: string; normalizedExpected: string } {
  // Dynamic import of wanakana — normalize both to hiragana
  // (wanakana is CJS, imported at call-site)
  const { toHiragana } = require('wanakana') as typeof import('wanakana')

  const norm = (s: string) =>
    toHiragana(s.trim().toLowerCase().replace(/\s+/g, ''), { passRomaji: false })

  const normalizedTranscript = norm(transcript)
  const normalizedExpected = norm(expected)
  const distance = levenshtein(normalizedTranscript, normalizedExpected)

  return {
    distance,
    passed: distance <= threshold,
    normalizedTranscript,
    normalizedExpected,
  }
}
