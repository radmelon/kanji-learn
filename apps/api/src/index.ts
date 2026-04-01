// Load .env before any other module reads process.env.
// Use an explicit path so it works regardless of what cwd is when the process starts.
import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: join(__dirname, '../../.env') })

const { buildServer } = await import('./server.js')
const { scheduleDailyReminders } = await import('./cron.js')

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'

const server = await buildServer()

try {
  await server.listen({ port, host })
  console.log(`🚀 API server listening on ${host}:${port}`)
  scheduleDailyReminders(server.db)
} catch (err) {
  server.log.error(err)
  process.exit(1)
}
