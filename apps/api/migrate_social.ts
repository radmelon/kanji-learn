import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { config as loadEnv } from 'dotenv'
const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: join(__dirname, '.env') })

const { db } = await import('@kanji-learn/db')
const { sql } = await import('drizzle-orm')

await db.execute(sql`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email text`)
await db.execute(sql`
  CREATE TABLE IF NOT EXISTS friendships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    addressee_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )
`)
await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS friendship_pair_idx ON friendships(requester_id, addressee_id)`)
await db.execute(sql`CREATE INDEX IF NOT EXISTS friendship_addressee_idx ON friendships(addressee_id)`)
await db.execute(sql`CREATE INDEX IF NOT EXISTS friendship_status_idx ON friendships(requester_id, status)`)

console.log('Social migration applied')
process.exit(0)
