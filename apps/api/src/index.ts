// Static imports are hoisted in ESM and run before top-level code, so dotenv
// MUST be a dynamic import to guarantee it loads before any module reads process.env.
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const { config: loadEnv } = await import('dotenv')
loadEnv({ path: join(__dirname, '../.env') })

// These dynamic imports happen after env is loaded, so DATABASE_URL etc. are set.
const { buildServer } = await import('./server.js')
const { scheduleDailyReminders } = await import('./cron.js')
const { db } = await import('@kanji-learn/db')

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'

const server = await buildServer()

// Start background jobs
scheduleDailyReminders(db)

try {
  await server.listen({ port, host })
  console.log(`🚀 API server listening on ${host}:${port}`)
} catch (err) {
  server.log.error(err)
  process.exit(1)
}
