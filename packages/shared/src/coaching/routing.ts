import type { FindingKind } from './types'

/**
 * WHERE a finding may be said, and to WHOM (spec 2026-08-07 §3, §4).
 *
 * This file exists because nobody owned placement. The coaching design's §12
 * slices the work six ways and none of them asks whether the notebook is the
 * right destination for a given finding, so everything landed in one tab on one
 * cadence by default. A literal table is the artifact that fixes that: greppable,
 * diffable, reviewable in one screen.
 *
 * Kept separate from `selection.ts` on purpose. Selection answers "which findings
 * are most worth saying"; routing answers "where may this kind be said, and to
 * whom". Merging them would put the thing this project could not previously point
 * at back inside a file that already does something else.
 */

/**
 * Opened on purpose by someone who wants the complete picture. Uncapped, does not
 * rotate, and NEVER burns novelty (§8). Capping or rotating one is a category
 * error.
 */
export const RECORD_SURFACES = ['journal', 'tutor_report'] as const
export type RecordSurface = typeof RECORD_SURFACES[number]

/**
 * Interrupts a moment. Shows few things, rotates so the same sentence does not
 * follow the learner around, and speaks a given finding at most once per analysis
 * cycle (§6).
 */
export const EVENT_SURFACES = ['placement', 'session_complete', 'progress', 'weekly'] as const
export type EventSurface = typeof EVENT_SURFACES[number]

export type Surface = RecordSurface | EventSurface

/** Who is reading. The tutor report is the only non-learner reader (§3.2). */
export type Audience = 'learner' | 'tutor'
