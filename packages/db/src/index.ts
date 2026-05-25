import postgres from 'postgres'

export * from './client'
export * from './schema'
export type { Db } from './client'
export { backfillUniversalKg } from './seeds/backfill-universal-kg'
export type { BackfillResult } from './seeds/backfill-universal-kg'

// Re-export postgres-js's PostgresError so consumers (e.g. apps/api) can do
// instanceof checks for PG error codes without taking a direct dep on the
// postgres package. The first deploy of nudge.service.ts shipped with a
// direct `import postgres from 'postgres'` and crashed at startup
// (ERR_MODULE_NOT_FOUND) because apps/api/node_modules in the production
// image doesn't include postgres — only packages/db's does.
export const PostgresError = postgres.PostgresError

