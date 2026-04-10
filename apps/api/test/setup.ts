// apps/api/test/setup.ts
// Loaded before every test file. Reads .env.test, exposes a shared test db.

import { config } from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = resolve(fileURLToPath(import.meta.url), '..')

config({ path: resolve(__dirname, '../.env.test') })

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL must be set in apps/api/.env.test before running tests'
  )
}

// Override DATABASE_URL with the test URL for any code that reads it
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
