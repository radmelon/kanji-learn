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
const FALSE_CLAIMS = new RegExp(
  [
    'ease factor',
    'SM-2', 'SM2', 'Woźniak', 'Wozniak',
    'interval doubl', '1/3/6', 'fixed interval',
    // The reset family. The first version of this list was
    // `resets? to (1|one) day`, which requires exact adjacency — so it missed
    // "resets to day 1" (study.tsx), "resets the interval back to 1 day"
    // (progress.tsx) and "resets the card's interval" (progress.tsx), all
    // three of which were shipping while this test passed. A search narrower
    // than its bug class is the whole of B-228; do not re-narrow it.
    'resets?[^.!?]{0,40}\\bday 1\\b',
    'resets?[^.!?]{0,40}\\b(1|one) day\\b',
    'resets?[^.!?]{0,40}\\binterval\\b',
    'back to (day )?(1|one)\\b',
    'start(s|ing)? over from (day )?(1|one)\\b',
  ].join('|'),
  'i',
)

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

/**
 * True when the match sits inside a comment rather than in rendered copy.
 *
 * The naive version — "is there a `//` anywhere before the match" — grants
 * amnesty to any rendered string containing a URL:
 *
 *   body: 'Read more at https://x.com — your ease factor decreases.'
 *
 * So `//` only counts when it is NOT inside a string literal. Quotes are
 * tracked left to right; anything after an unclosed quote is string content.
 */
function isComment(line: string, matchIndex: number): boolean {
  if (line.trimStart().startsWith('*')) return true

  let quote: string | null = null
  for (let i = 0; i < matchIndex; i++) {
    const ch = line[i]!
    if (ch === '\\') { i++; continue }
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    // `https://` in BARE JSX TEXT is not a string literal, so quote tracking
    // alone does not save us — the `//` would read as a comment opener and
    // grant amnesty to the whole line. A scheme separator is never a comment.
    if (ch === '/' && line[i + 1] === '/' && line[i - 1] === ':') { i++; continue }
    if (ch === '/' && (line[i + 1] === '/' || line[i + 1] === '*')) return true
  }
  return false
}

/**
 * Tests for the detector itself.
 *
 * The first version of this file proved only that the *harness* worked, by
 * reinjecting "ease factor" — a string the pattern already matched. It said
 * nothing about the pattern's coverage, and the pattern was in fact missing
 * three claims that were live in the app at the time. These cases pin the
 * exact strings that escaped, so re-narrowing the pattern fails here.
 */
// Named for B-228 deliberately: BUGS.md's acceptance command is
// `jest -t "B-228"`, which matches on describe text. Called anything else,
// this entire block — where the regression pins live — is silently skipped by
// the very command the bug prescribes for verifying itself.
describe('the B-228 detector', () => {
  const ESCAPED_B228 = [
    // study.tsx:999 — the second grade-help surface
    "{ label: 'Again', color: colors.error, desc: 'Complete blank — resets to day 1' },",
    // progress.tsx:64 — "What is Spaced Repetition?"
    "body: 'A wrong answer resets the interval back to 1 day.',",
    // progress.tsx:82 — "How confidence is measured"
    "body: '• Again — you forgot it; resets the card\\'s interval (not confident)',",
  ]

  it.each(ESCAPED_B228)('matches a claim that slipped past the first pattern: %s', (line) => {
    expect(FALSE_CLAIMS.test(line)).toBe(true)
  })

  it('catches a claim split across a line break once whitespace is collapsed', () => {
    // The sweep scans line by line, and JSX prose in this repo wraps freely,
    // so a claim broken at a newline is invisible to it. A whole-file scan
    // currently finds zero live instances — latent, not present — but the
    // mitigation is three lines, so the sweep runs it anyway.
    const wrapped = "        <Text>a wrong answer resets\n          the interval</Text>"
    // The sweep splits on newlines first, so it never sees the whole claim.
    expect(wrapped.split('\n').some((l) => FALSE_CLAIMS.test(l))).toBe(false)
    // Collapsed, it is plain. This is why the sweep runs a second pass.
    expect(FALSE_CLAIMS.test(wrapped.replace(/\s+/g, ' '))).toBe(true)
  })

  it('does not fire on the corrected wording that replaced them', () => {
    for (const line of [
      "desc: 'Complete blank — the drop is proportional, not a wipe'",
      "body: 'A wrong answer shrinks that memory strength rather than resetting it'",
      "body: '• Again — you forgot it; shrinks the card\\'s interval'",
      "body: 'Stability grows the most and the card gets marked easier'",
    ]) {
      expect(FALSE_CLAIMS.test(line)).toBe(false)
    }
  })

  it('does not treat a URL inside rendered copy as a comment', () => {
    const line = "  body: 'Read more at https://example.com — your ease factor decreases.',"
    const match = FALSE_CLAIMS.exec(line)!
    expect(match).toBeTruthy()
    expect(isComment(line, match.index)).toBe(false)
  })

  it('still recognises real comments', () => {
    const real = "// B-228: this used to claim an ease factor"
    expect(isComment(real, FALSE_CLAIMS.exec(real)!.index)).toBe(true)
    const jsx = "            {/* B-228: this credited SM-2 */}"
    expect(isComment(jsx, FALSE_CLAIMS.exec(jsx)!.index)).toBe(true)
    const trailing = "  quality: number   // SM-2 0–5"
    expect(isComment(trailing, FALSE_CLAIMS.exec(trailing)!.index)).toBe(true)
    const block = "     * describes an ease factor"
    expect(isComment(block, FALSE_CLAIMS.exec(block)!.index)).toBe(true)
  })
})

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
          (a) =>
            relative(a.file, file) === '' &&
            line.includes(a.contains) &&
            // The allowance covers the approved excerpt, not the whole line —
            // otherwise an allowlisted line that later gains a SECOND,
            // different false claim gets in free.
            a.contains.toLowerCase().includes(match[0].toLowerCase()),
        )
        if (allowed) return
        offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 140)}`)
      })

      // Second pass: the same pattern over the whole file with whitespace
      // collapsed, which catches a claim broken across a line break. Reported
      // separately because there is no line number to give.
      const collapsed = readFileSync(join(REPO, file), 'utf8').replace(/\s+/g, ' ')
      if (FALSE_CLAIMS.test(collapsed) && !lines.some((l) => FALSE_CLAIMS.test(l))) {
        offenders.push(`${file}  (claim visible only when wrapped lines are joined)`)
      }
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
    expect(grade).toContain('proportional rather than a wipe')

    // The second grade-help surface — the study-tab onboarding modal. It said
    // "resets to day 1" while pointing the learner at the copy above, so the
    // two contradicted each other. Both must stay corrected.
    // Both surfaces use the SAME proportional framing. "not to day 1" is
    // avoided on purpose: a low-stability card lands on the 1-day interval
    // floor regardless, and the onboarding modal's audience is exactly that
    // band, so the claim fails hardest where it is read most.
    const studyTab = readFileSync(join(REPO, 'apps/mobile/app/(tabs)/study.tsx'), 'utf8')
    expect(studyTab).toContain('the drop is proportional, not a wipe')
  })
})
