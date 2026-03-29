// ─── Stroke Scoring ───────────────────────────────────────────────────────────
//
// Evaluates a user's freehand kanji strokes against KanjiVG reference paths
// on three axes:
//
//   Count     (35%) — did the user draw the right number of strokes?
//   Direction (40%) — is each stroke going roughly the right way?
//   Order     (25%) — were strokes drawn in the correct spatial sequence?
//
// All reference coordinates are in KanjiVG's 109×109 space and are scaled
// to match the canvas dimensions before comparison.

const KVG_SIZE = 109  // KanjiVG coordinate space

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Point { x: number; y: number }
export interface UserStroke { points: Point[] }
export interface RefStroke { d: string }

export interface StrokeScore {
  total: number           // 0–1 composite
  countScore: number      // 0–1
  directionScore: number  // 0–1
  orderScore: number      // 0–1
  feedback: FeedbackItem[]
}

export interface FeedbackItem {
  icon: 'check' | 'close' | 'warning'
  label: string
  detail: string
}

// ─── SVG Path Parser ──────────────────────────────────────────────────────────
// Extracts the start and end point of a KanjiVG path segment.
// KanjiVG uses: M (absolute move), c (relative cubic bezier), q (relative quad),
// l (relative line), L (absolute line), C (absolute cubic), Q (absolute quad).

function parseStartPoint(d: string): Point | null {
  const m = d.match(/^M\s*([\d.-]+)[,\s]([\d.-]+)/)
  if (!m) return null
  return { x: parseFloat(m[1]), y: parseFloat(m[2]) }
}

function parseEndPoint(d: string): Point | null {
  const start = parseStartPoint(d)
  if (!start) return null

  let x = start.x
  let y = start.y

  // Split into command segments
  const segments = d.match(/[MLCQcqlmtaA][^MLCQcqlmtaA]*/g) ?? []

  for (const seg of segments) {
    const cmd = seg[0]
    const nums = (seg.slice(1).match(/-?[\d.]+/g) ?? []).map(Number)
    if (nums.length === 0) continue

    switch (cmd) {
      case 'M': case 'L':
        x = nums[nums.length - 2]; y = nums[nums.length - 1]; break
      case 'm': case 'l':
        x += nums[nums.length - 2]; y += nums[nums.length - 1]; break
      case 'C':
        // absolute cubic: groups of 6, endpoint is last x,y
        x = nums[nums.length - 2]; y = nums[nums.length - 1]; break
      case 'c':
        // relative cubic: groups of 6 (dx1,dy1, dx2,dy2, dx,dy)
        for (let i = 0; i + 5 < nums.length; i += 6) {
          x += nums[i + 4]; y += nums[i + 5]
        }
        // handle remainder that isn't a full group
        break
      case 'Q':
        x = nums[nums.length - 2]; y = nums[nums.length - 1]; break
      case 'q':
        // relative quad: groups of 4 (dx1,dy1, dx,dy)
        for (let i = 0; i + 3 < nums.length; i += 4) {
          x += nums[i + 2]; y += nums[i + 3]
        }
        break
    }
  }

  return { x, y }
}

// ─── Vector helpers ───────────────────────────────────────────────────────────

function cosSimilarity(ax: number, ay: number, bx: number, by: number): number {
  const magA = Math.sqrt(ax * ax + ay * ay)
  const magB = Math.sqrt(bx * bx + by * by)
  if (magA < 0.5 || magB < 0.5) return 1  // degenerate stroke — don't penalise
  return (ax * bx + ay * by) / (magA * magB)
}

function centroid(points: Point[]): Point {
  const sum = points.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 })
  return { x: sum.x / points.length, y: sum.y / points.length }
}

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// ─── Main scorer ──────────────────────────────────────────────────────────────

export function scoreStrokes(
  userStrokes: UserStroke[],
  refStrokes: RefStroke[],
  canvasWidth: number,
  canvasHeight: number,
): StrokeScore {
  const feedback: FeedbackItem[] = []
  const scaleX = canvasWidth / KVG_SIZE
  const scaleY = canvasHeight / KVG_SIZE

  const nUser = userStrokes.length
  const nRef  = refStrokes.length

  // ── Count score ─────────────────────────────────────────────────────────────

  const countDiff = Math.abs(nUser - nRef)
  const countScore = nRef > 0 ? Math.max(0, 1 - countDiff / nRef) : nUser > 0 ? 1 : 0

  if (nUser === nRef) {
    feedback.push({ icon: 'check', label: 'Stroke count', detail: `${nRef} stroke${nRef !== 1 ? 's' : ''} — correct!` })
  } else if (nUser < nRef) {
    feedback.push({ icon: 'warning', label: 'Stroke count', detail: `${nUser} drawn, expected ${nRef} — missing ${nRef - nUser}` })
  } else {
    feedback.push({ icon: 'warning', label: 'Stroke count', detail: `${nUser} drawn, expected ${nRef} — ${nUser - nRef} extra` })
  }

  const n = Math.min(nUser, nRef)
  if (n === 0) {
    return { total: 0, countScore: 0, directionScore: 0, orderScore: 0, feedback }
  }

  // Pre-compute reference start/end endpoints (scaled to canvas)
  const refEndpoints = refStrokes.map((r) => {
    const s = parseStartPoint(r.d)
    const e = parseEndPoint(r.d)
    if (!s || !e) return null
    return {
      start: { x: s.x * scaleX, y: s.y * scaleY },
      end:   { x: e.x * scaleX, y: e.y * scaleY },
    }
  })

  // ── Direction score ──────────────────────────────────────────────────────────
  // Compare direction of each user stroke vs the paired reference stroke.

  let dirTotal = 0
  let badDir = 0

  for (let i = 0; i < n; i++) {
    const user = userStrokes[i]
    const ref  = refEndpoints[i]
    if (!ref || user.points.length < 2) { dirTotal += 1; continue }

    const uf = user.points[0]
    const ul = user.points[user.points.length - 1]

    const cos = cosSimilarity(
      ul.x - uf.x, ul.y - uf.y,
      ref.end.x - ref.start.x, ref.end.y - ref.start.y,
    )
    // cos: 1 = same direction, 0 = perpendicular, -1 = opposite
    const strokeDirScore = Math.max(0, cos)
    dirTotal += strokeDirScore

    const angleDeg = Math.acos(Math.max(-1, Math.min(1, cos))) * (180 / Math.PI)
    if (angleDeg > 50) badDir++
  }

  const directionScore = dirTotal / n

  if (badDir === 0) {
    feedback.push({ icon: 'check', label: 'Stroke direction', detail: 'All strokes going the right way' })
  } else {
    feedback.push({
      icon: badDir > n / 2 ? 'close' : 'warning',
      label: 'Stroke direction',
      detail: `${badDir} stroke${badDir !== 1 ? 's' : ''} going the wrong direction — watch the animation`,
    })
  }

  // ── Order score ──────────────────────────────────────────────────────────────
  // Only evaluate order when stroke count is correct — if strokes are missing or
  // extra the centroid matching is unreliable and produces false negatives.

  let orderScore = 1

  if (n <= 1 || nUser !== nRef) {
    // Skip — not enough data or count mismatch makes matching meaningless
    if (n > 1 && nUser === nRef) { /* evaluated below */ }
  }

  if (n > 1 && nUser === nRef) {
    const refCentroids = refEndpoints.map((ep) =>
      ep ? { x: (ep.start.x + ep.end.x) / 2, y: (ep.start.y + ep.end.y) / 2 } : { x: 0, y: 0 }
    )

    // Unique greedy matching — each reference stroke can only be claimed once.
    // Without this, two user strokes near the same reference stroke both match
    // the same index, making the sequence look out of order even when it isn't.
    const usedRef = new Set<number>()
    const matchedIdx: number[] = []

    for (let ui = 0; ui < n; ui++) {
      const u = userStrokes[ui]
      if (u.points.length === 0) { matchedIdx.push(ui); continue }
      const uc = centroid(u.points)
      let best = -1, bestD = Infinity
      refCentroids.forEach((rc, ri) => {
        if (usedRef.has(ri)) return
        const d = dist(uc, rc)
        if (d < bestD) { bestD = d; best = ri }
      })
      if (best === -1) best = ui  // fallback: identity mapping
      matchedIdx.push(best)
      usedRef.add(best)
    }

    // Count how many consecutive pairs are in ascending order
    let inOrder = 0
    for (let i = 0; i < matchedIdx.length; i++) {
      if (i === 0 || matchedIdx[i] > matchedIdx[i - 1]) inOrder++
    }
    orderScore = inOrder / matchedIdx.length

    if (orderScore >= 0.75) {
      feedback.push({ icon: 'check', label: 'Stroke order', detail: 'Strokes in the correct sequence' })
    } else if (orderScore >= 0.5) {
      feedback.push({ icon: 'warning', label: 'Stroke order', detail: 'A few strokes out of order — follow the numbered animation' })
    } else {
      feedback.push({ icon: 'close', label: 'Stroke order', detail: 'Stroke order needs practice — watch the animation carefully' })
    }
  }

  // ── Composite ────────────────────────────────────────────────────────────────

  const total = Math.round((0.35 * countScore + 0.40 * directionScore + 0.25 * orderScore) * 100) / 100

  return { total, countScore, directionScore, orderScore, feedback }
}
