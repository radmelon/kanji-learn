import { drizzle } from 'drizzle-orm/postgres-js'
import { PgJsonb } from 'drizzle-orm/pg-core'
import postgres from 'postgres'
import * as schema from './schema'

// Storage-layer fix for jsonb double-encoding.
//
// Drizzle's PgJsonb.mapToDriverValue calls JSON.stringify(value), then
// postgres-js's jsonb serializer ALSO calls JSON.stringify on what it
// received — producing a JSON-encoded string like "{\"k\":\"v\"}" instead
// of the object {"k":"v"}. The round-trip via JS still worked (drizzle's
// mapFromDriverValue JSON.parses), but SQL-side queries like
// payload->>'kind' returned NULL because the stored value was a jsonb
// string, not an object. This broke partial unique indexes that index on
// (action_payload->>'kind') and (action_payload->>'milestone').
//
// Override mapToDriverValue to pass values through. postgres-js then
// receives JS objects and JSON-encodes once. Reads still work because
// mapFromDriverValue returns objects as-is (postgres-js parses jsonb to
// JS values automatically).
//
// NOTE: existing rows written before this fix remain double-encoded in
// the DB. New writes are correctly encoded. Affects all jsonb columns.
;(PgJsonb.prototype as unknown as { mapToDriverValue: (v: unknown) => unknown }).mapToDriverValue =
  (value: unknown) => value

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
