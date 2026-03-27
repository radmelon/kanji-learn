import type { Db } from '@kanji-learn/db'

declare module 'fastify' {
  interface FastifyInstance {
    db: Db
  }
}
