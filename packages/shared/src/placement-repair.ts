/**
 * One row from `user_kanji_progress`, the fields the B-210 write signature
 * touches. `status` is a plain string here (not `SrsStatus`) so this stays
 * usable from a raw-SQL script without importing the DB enum type.
 */
export interface PlacementDamageRow {
  status: string
  stability: number
  difficulty: number
  totalReviews: number
}

/**
 * True when a row exactly matches the write `applyPlacementResults` used to
 * make on a passed placement item: status='remembered', stability=21,
 * difficulty=5, totalReviews=1. This combination cannot arise from a genuine
 * FSRS review — DEFAULT_FSRS_WEIGHTS[4] (the first-review difficulty base)
 * is 7.1949, not 5, and no rating produces stability=21 on a first review.
 */
export function isPlacementDamageSignature(row: PlacementDamageRow): boolean {
  return (
    row.status === 'remembered' &&
    row.stability === 21 &&
    row.difficulty === 5 &&
    row.totalReviews === 1
  )
}
