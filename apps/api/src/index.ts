// Load .env before any other module reads process.env (ESM-safe: dynamic import is not hoisted)
await import('dotenv/config')

const { buildServer } = await import('./server.js')

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'

const server = await buildServer()

try {
  await server.listen({ port, host })
  console.log(`🚀 API server listening on ${host}:${port}`)
} catch (err) {
  server.log.error(err)
  process.exit(1)
}
