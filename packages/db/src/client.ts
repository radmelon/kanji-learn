import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required')
}

// Switch to transaction-mode pooler (port 6543) for better concurrency.
// Session-mode (port 5432) has a low concurrent-connection cap on Supabase
// and causes MaxClientsInSessionMode errors under load.
// Transaction mode requires prepare:false (no server-side prepared statements).
const transactionModeUrl = connectionString.replace(':5432/', ':6543/')

const queryClient = postgres(transactionModeUrl, {
  prepare: false,    // required for PgBouncer / Supabase transaction-mode pooler
  max: 5,            // max connections per API instance (2 instances = 10 total)
  idle_timeout: 30,  // release idle connections after 30 s
  connect_timeout: 10,
})

export const db = drizzle(queryClient, { schema })
export type Db = typeof db
