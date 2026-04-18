// apps/api/src/lib/supabase-admin.ts
//
// Service-role Supabase client for elevated-privilege operations
// (account deletion, etc.). Isolated from the RLS-aware query path so
// any route reaching for admin powers is obvious at grep time.
//
// NEVER use this client to satisfy normal route reads/writes — those
// must continue going through the JWT-bound drizzle path so RLS holds.

import { createClient } from '@supabase/supabase-js'
import { env } from './env.js'

export const supabaseAdmin = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
)
