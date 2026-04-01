#!/usr/bin/env tsx
/**
 * Backfills daily_stats from review_logs for all users.
 * Safe to re-run — uses ON CONFLICT DO UPDATE (additive).
 */
import 'dotenv/config'
import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL not set')

const sql = postgres(connectionString, { max: 1 })

async function main() {
  const result = await sql`
    INSERT INTO daily_stats (user_id, date, reviewed, correct, new_learned, burned, study_time_ms)
    SELECT
      user_id,
      DATE(reviewed_at AT TIME ZONE 'UTC')::text AS date,
      COUNT(*)::int                                                                AS reviewed,
      COUNT(CASE WHEN quality >= 3 THEN 1 END)::int                               AS correct,
      COUNT(CASE WHEN prev_status = 'unseen' THEN 1 END)::int                     AS new_learned,
      COUNT(CASE WHEN next_status = 'burned' AND prev_status != 'burned' THEN 1 END)::int AS burned,
      0                                                                            AS study_time_ms
    FROM review_logs
    GROUP BY user_id, DATE(reviewed_at AT TIME ZONE 'UTC')
    ON CONFLICT (user_id, date) DO UPDATE SET
      reviewed    = EXCLUDED.reviewed,
      correct     = EXCLUDED.correct,
      new_learned = EXCLUDED.new_learned,
      burned      = EXCLUDED.burned
    RETURNING date, reviewed, correct
  `
  console.log(`Backfilled ${result.length} daily_stats rows:`)
  result.forEach((r: any) => console.log(`  ${r.date}: ${r.reviewed} reviewed, ${r.correct} correct`))
  await sql.end()
}

main().catch(e => { console.error(e); process.exit(1) })
