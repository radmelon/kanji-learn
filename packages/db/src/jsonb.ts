import { customType } from 'drizzle-orm/pg-core'

/**
 * `jsonb` column type — drop-in replacement for drizzle-orm's built-in `jsonb`.
 *
 * The built-in type double-encodes every value:
 *
 *  1. drizzle-orm's `jsonb.mapToDriverValue` calls `JSON.stringify(value)`,
 *     turning the object into a JSON *string*.
 *  2. postgres-js then stringifies a SECOND time. On a parameterised write the
 *     Postgres server reports the parameter's type as `jsonb` (oid 3802) in its
 *     ParameterDescription; postgres-js's serializer for oid 3802 is
 *     `JSON.stringify`, so it re-encodes the already-stringified string.
 *
 * The column ends up holding a JSON string scalar (`jsonb_typeof` = 'string')
 * instead of a real object, and SQL path operators (`->`, `#>>`, `@>`) silently
 * return NULL.
 *
 * This type omits the `mapToDriverValue` stringify (`toDriver` is the identity),
 * so postgres-js serializes the value exactly once and the column stores a
 * proper jsonb object/array.
 */
export const jsonb = (name: string) =>
  customType<{ data: unknown; driverData: unknown }>({
    dataType() {
      return 'jsonb'
    },
    // Hand postgres-js the raw value — it performs the single JSON encode.
    toDriver(value) {
      return value
    },
    // Rows written before this fix are stored double-encoded: postgres-js
    // parses the outer layer on read, leaving a JSON string. Decode it so
    // legacy rows still read back as objects until the data repair runs.
    fromDriver(value) {
      if (typeof value === 'string') {
        try {
          return JSON.parse(value)
        } catch {
          return value
        }
      }
      return value
    },
  })(name)
