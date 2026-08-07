#!/usr/bin/env node
/**
 * Live-render smoke check for coaching copy — spec §12.5.
 *
 * Pulls every real learner, assembles their snapshot through the PRODUCTION
 * path, renders every finding that fires, and prints each sentence next to the
 * evidence it was built from so a human can check one against the other.
 *
 * Read-only. Writes nothing. Safe against live data.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Eight truthfulness defects were found on the copy-floor branch. Every one was
 * found by rendering a sentence and checking it against its detector or against
 * live data. NONE was found by a failing test, and 541 shared tests pass either
 * way.
 *
 * The blind spot is structural, not an oversight: every fixture in the suite is
 * self-consistent by construction, so no fixture can reproduce a stored value
 * disagreeing with a recomputed one, or a superlative that is true of the
 * fixture and false of a real learner. coaching-snapshot.test.ts even carried
 * an invariant assertion that live data violated, because it seeded its input
 * from the same source it asserted against.
 *
 * ─── WHY IT BYPASSES SELECTION ──────────────────────────────────────────────
 * analyze() takes the top DEFAULT_FINDING_COUNT (3). That cap is correct for a
 * learner and useless for a smoke check: on 2026-08-06 only 5 of the 10 kinds
 * had EVER reached a notebook entry, so half the shipped copy had never been
 * read against real data. Passing count = 10 renders everything that fires.
 *
 * The report separates two very different things a cap hides:
 *   SHOWN   — production would put this in front of the learner today
 *   HIDDEN  — it fires, but lost the top-3 cut, so nobody has ever read it
 *   SILENT  — the detector returned null; there is nothing to render
 *
 * ─── USAGE (from repo root) ─────────────────────────────────────────────────
 *   ./scripts/with-live-db.sh node --import tsx/esm scripts/coaching-smoke-render.mjs
 *
 * ...or, with the workspace tsx fallback:
 *   ./scripts/with-live-db.sh node \
 *     --import ./packages/db/node_modules/tsx/dist/esm/index.cjs \
 *     scripts/coaching-smoke-render.mjs
 *
 * Optional: --user <uuid> to render a single learner.
 *
 * ─── --as-of <iso>: RENDERING A KIND THAT IS SILENT TODAY ───────────────────
 * Three kinds reported SILENT on every run up to 2026-08-07, and the report
 * told you to "construct a learner whose data makes them fire" — i.e. build a
 * fixture, which is the exact blind spot documented above.
 *
 * There is a better instrument. All three were silent for TIMING reasons, not
 * missing data: this learner's real history already satisfies each detector,
 * just not at this instant. So rewind the clock over real rows instead:
 *
 *   --as-of 2026-08-08          commitment_gap  (the period ends 08-08; before
 *                               that getLastCompletedPeriod skips it)
 *   --as-of 2026-05-21          fluency_gain    (needs one card reviewed in
 *                               BOTH halves of the 30-day window; 158 cards
 *                               qualified then, none do in the current window)
 *   --as-of 2026-08-01T20:00Z   theta_delta     (needs two placements far
 *                               enough apart to clear their combined noise)
 *
 * Every number rendered is a real stored value. What is simulated is only WHEN
 * you are standing, which is precisely the variable that made them silent.
 */

import { createRequire } from 'node:module'
import { db } from '../packages/db/src/client.ts'
import { CoachingService, COACHING_SOURCE_KIND } from '../apps/api/src/services/buddy/coaching.service.ts'
import { analyze, templateCopy, FINDING_PRIORITY } from '../packages/shared/src/coaching/index.ts'

// Bare specifiers do not resolve from repo-root scripts/ — there is no
// node_modules here. Same fix as detect-placement-damage.mjs: resolve through
// packages/db, which does have them. The relative .ts imports above are fine;
// they resolve their own bare specifiers from their own package.
const require = createRequire(new URL('../packages/db/src/index.ts', import.meta.url))
const { sql } = require('drizzle-orm')

const ALL_KINDS = Object.keys(FINDING_PRIORITY)

const args = process.argv.slice(2)
const userIdx = args.indexOf('--user')
const SINGLE_USER = userIdx >= 0 ? args[userIdx + 1] : null

const asOfIdx = args.indexOf('--as-of')
const AS_OF = asOfIdx >= 0 ? args[asOfIdx + 1] : null
if (AS_OF && Number.isNaN(Date.parse(AS_OF))) {
  console.error(`--as-of: not a parsable date: ${AS_OF}`)
  process.exit(1)
}

// A bare date means midnight UTC, which is what the --as-of examples above
// assume. Date.parse handles both that and a full ISO instant.
const now = AS_OF ? new Date(AS_OF).toISOString() : new Date().toISOString()
const svc = new CoachingService(db)

const bar = (c) => c.repeat(78)

function fmtEvidence(e) {
  const who = e.character ? `${e.character} ` : e.kanjiId ? `#${e.kanjiId} ` : ''
  return `      · ${who}${e.label} = ${e.value}`
}

async function main() {
  const learners = SINGLE_USER
    ? [{ user_id: SINGLE_USER }]
    : (await db.execute(sql`
        SELECT DISTINCT u.id AS user_id
          FROM user_profiles u
         ORDER BY u.id
      `))

  console.log(bar('═'))
  console.log(`COACHING LIVE-RENDER SMOKE CHECK   ${now}`)
  if (AS_OF) {
    console.log('⏪ --as-of: the clock is rewound over REAL rows. Every value below is')
    console.log('   a stored one; only the instant you are standing at is simulated.')
    console.log('   Coverage here does NOT describe what production shows today.')
  }
  console.log(`${learners.length} learner(s). Read each sentence against the evidence under it.`)
  console.log(bar('═'))

  // kind -> how many learners rendered it, split by whether production shows it
  const coverage = new Map(ALL_KINDS.map((k) => [k, { shown: 0, hidden: 0 }]))

  for (const row of learners) {
    const userId = row.user_id
    let priors = []
    try {
      // In --as-of mode the priors must also be the ones that existed THEN.
      // Carrying today's priors back would decay novelty for findings that had
      // not been raised yet, and novelty drives selection.
      const priorRows = await db.execute(sql`
        SELECT source
          FROM notebook_entries
         WHERE user_id = ${userId}
           AND source->>'kind' = ${COACHING_SOURCE_KIND}
           AND (${AS_OF}::timestamptz IS NULL OR created_at <= ${AS_OF}::timestamptz)
         ORDER BY created_at DESC
         LIMIT 1
      `)
      priors = priorRows[0]?.source?.findings ?? []
    } catch (e) {
      console.log(`\n  ! could not read priors for ${userId}: ${e.message}`)
    }

    let snapshot
    try {
      // `historical` closes the review/quiz windows at `now` and time-filters
      // placement — the two things `now` alone does not reach. Omitted without
      // --as-of, so the default run is the production call it has always made.
      snapshot = await svc.assembleSnapshot(userId, now, priors,
        AS_OF ? { historical: true } : {})
    } catch (e) {
      console.log(`\n${bar('─')}\nLEARNER ${userId}\n  ! assembleSnapshot failed: ${e.message}`)
      continue
    }

    // Production's actual selection, and then everything that fired.
    const shown = analyze(snapshot, 3)
    const all = analyze(snapshot, ALL_KINDS.length)
    const shownKinds = new Set(shown.map((f) => f.kind))

    console.log(`\n${bar('─')}`)
    console.log(`LEARNER ${userId}`)
    console.log(`  placement: ${snapshot.placement ? 'yes' : 'none'}   ` +
      `active cards: ${snapshot.reviews?.cards?.filter((c) => c.status !== 'unseen' && c.status !== 'burned').length ?? 0}   ` +
      `commitment: ${snapshot.commitment ? 'yes' : 'none'}   priors: ${priors.length}`)
    console.log(`  ${all.length} of ${ALL_KINDS.length} kinds fired; production shows ${shown.length}`)
    console.log(bar('─'))

    if (all.length === 0) {
      console.log('  (nothing fired — no sentences to check)')
      continue
    }

    for (const f of all) {
      const isShown = shownKinds.has(f.kind)
      const tag = isShown ? 'SHOWN ' : 'HIDDEN'
      coverage.get(f.kind)[isShown ? 'shown' : 'hidden'] += 1

      let sentence
      try {
        sentence = templateCopy(f, now)
      } catch (e) {
        sentence = `!! templateCopy threw: ${e.message}`
      }

      console.log(`\n  [${tag}] ${f.kind}   ` +
        `magnitude=${f.magnitude.toFixed(3)} confidence=${f.confidence.toFixed(3)} ` +
        `since=${f.since ?? 'null'}`)
      console.log(`      ${sentence}`)
      if (f.evidence.length > 0) {
        console.log('      ── evidence it was built from ──')
        for (const e of f.evidence) console.log(fmtEvidence(e))
      } else {
        console.log('      (no evidence — fixed copy by contract)')
      }
    }
  }

  console.log(`\n${bar('═')}`)
  console.log('COVERAGE — which of the ten kinds got rendered at all')
  console.log(bar('═'))
  for (const kind of ALL_KINDS) {
    const c = coverage.get(kind)
    const total = c.shown + c.hidden
    const state = total === 0
      ? 'SILENT — never fired, never rendered, still unchecked'
      : `rendered ${total}x (production shows it ${c.shown}x, hidden by the top-3 cut ${c.hidden}x)`
    console.log(`  ${kind.padEnd(20)} ${state}`)
  }

  const silent = ALL_KINDS.filter((k) => {
    const c = coverage.get(k)
    return c.shown + c.hidden === 0
  })
  console.log(bar('─'))
  if (silent.length === 0) {
    console.log('  All ten kinds rendered. Every shipped sentence has now been read against live data.')
  } else {
    console.log(`  ${silent.length} kind(s) did not fire, so their copy is unverified at this`)
    console.log('  instant — tests alone have never caught a defect in this class.')
    console.log('  Prefer --as-of <iso> over building a fixture: all three kinds silent on')
    console.log('  2026-08-07 were silent for TIMING reasons, and rewinding the clock')
    console.log('  rendered every one of them from real stored rows. See the header comment.')
  }
  console.log(bar('═'))
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
