// apps/api/test/setup.ts
// Loaded before every test file. Reads .env.test, exposes a shared test db.

import { config } from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = resolve(fileURLToPath(import.meta.url), '..')

// `override: true` because the dev shell commonly pre-sets ANTHROPIC_API_KEY
// (often to an empty string), which would otherwise block the stub value in
// .env.test from landing and trip env.ts's strict sk-ant- prefix check when
// a test imports buildServer().
config({ path: resolve(__dirname, '../.env.test'), override: true })

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Copy apps/api/.env.test.example to apps/api/.env.test and fill in TEST_DATABASE_URL.'
  )
}

// Override DATABASE_URL with the test URL for any code that reads it
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
