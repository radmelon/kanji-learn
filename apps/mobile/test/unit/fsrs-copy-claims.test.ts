/**
 * B-228's acceptance criterion, as a test.
 *
 * The original terminology sweep (`957fab7`) was declared complete on a scope
 * that was never tested for completeness: it defined its bug class semantically
 * ("strings describing SM-2 mechanics FSRS does not have") and then derived its
 * file list lexically by grepping `SRS`. Those do not coincide —
 * `GradeButtons.tsx` never says "SRS", it says *"ease factor"*, and it shipped
 * three false mechanics claims and a Woźniak credit to users for months.
 *
 * So the acceptance criterion is not a file list. It is this search, over every
 * user-facing surface, returning nothing that is not explicitly dispositioned:
 *
 *   - a match inside a **comment** is allowed (code comments are not shown to
 *     users, and the 0–5 quality scale genuinely is SM-2's);
 *   - a match in **rendered copy** must appear in ALLOWED_RENDERED below, with
 *     a reason.
 *
 * A new hit fails here rather than reaching a learner.
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, resolve } from 'path'

const REPO = resolve(__dirname, '../../../..')

/** Every surface a learner can read. Mirrors the grep in BUGS.md's B-228. */
const SEARCH_ROOTS = [
  'apps/mobile/app',
  'apps/mobile/src',
  'apps/watch',
  'README.md',
]

/**
 * The wrong *claims*, not the right word. "SRS" is deliberately absent: FSRS is
 * a spaced repetition system, and generic category use of "SRS" is accurate and
 * owner-approved (see B-228's defence of the reported symptom).
 */
const FALSE_CLAIMS =
  /ease factor|SM-2|SM2|Woźniak|Wozniak|interval doubl|1\/3\/6|fixed interval|resets? to (1|one) day/i

/**
 * Rendered strings that match the pattern but are accurate. Each needs a reason
 * — this list is the record of what was looked at and kept, which is the part
 * the first sweep skipped.
 */
const ALLOWED_RENDERED: { file: string; contains: string; reason: string }[] = [
  {
    file: 'apps/mobile/app/(tabs)/progress.tsx',
    contains: 'not a fixed 1/3/6-month checklist',
    reason:
      'A denial of the 1/3/6 schedule, not a claim to use one. Correcting this string would reintroduce the false impression it exists to remove.',
  },
]

function walk(path: string, out: string[] = []): string[] {
  const full = join(REPO, path)
  let st
  try {
    st = statSync(full)
  } catch {
    return out
  }
  if (st.isFile()) {
    out.push(path)
    return out
  }
  for (const entry of readdirSync(full)) {
    if (entry === 'node_modules' || entry === '__tests__' || entry.startsWith('.')) continue
    walk(join(path, entry), out)
  }
  return out
}

/** True when the match sits inside a comment rather than in rendered copy. */
function isComment(line: string, matchIndex: number): boolean {
  const before = line.slice(0, matchIndex)
  return (
    before.includes('//') ||
    before.includes('/*') ||
    before.trimStart().startsWith('*')
  )
}

describe('B-228 — no user-facing string claims mechanics FSRS does not have', () => {
  const files = SEARCH_ROOTS.flatMap((root) => walk(root)).filter(
    (f) => /\.(ts|tsx|swift|md)$/.test(f) && !/\.test\./.test(f),
  )

  it('searches a non-trivial number of files (guards against a silently empty sweep)', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('finds no undispositioned false-mechanics claim in rendered copy', () => {
    const offenders: string[] = []

    for (const file of files) {
      const lines = readFileSync(join(REPO, file), 'utf8').split('\n')
      lines.forEach((line, i) => {
        const match = FALSE_CLAIMS.exec(line)
        if (!match) return
        if (isComment(line, match.index)) return
        const allowed = ALLOWED_RENDERED.some(
          (a) => relative(a.file, file) === '' && line.includes(a.contains),
        )
        if (allowed) return
        offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 140)}`)
      })
    }

    if (offenders.length > 0) {
      throw new Error(
        `Rendered copy makes a mechanics claim FSRS does not implement:\n\n${offenders.join('\n')}\n\n` +
          `Rewrite it against packages/shared/src/srs.ts (stability + difficulty; no ease factor, ` +
          `no day-1 reset), or add it to ALLOWED_RENDERED with a reason if it is accurate.`,
      )
    }
    expect(offenders).toEqual([])
  })

  it('still credits FSRS, not SM-2, on the two surfaces B-228 named', () => {
    const grade = readFileSync(join(REPO, 'apps/mobile/src/components/study/GradeButtons.tsx'), 'utf8')
    const statusBar = readFileSync(join(REPO, 'apps/mobile/src/components/ui/SrsStatusBar.tsx'), 'utf8')

    // The rendered attribution paragraph.
    expect(statusBar).toContain('Free Spaced Repetition Scheduler')
    expect(statusBar).toContain('Ebbinghaus') // retained — the forgetting curve is real
    expect(statusBar).not.toContain('SuperMemo')

    // The grade help modal, reachable from every review.
    expect(grade).toContain('Stability shrinks')
    expect(grade).toContain('not reset to day 1')
  })
})
