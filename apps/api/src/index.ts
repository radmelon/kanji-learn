import { buildServer } from './server.js'

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
