import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_JWT_SECRET: z.string().min(32),
  SUPABASE_SERVICE_ROLE_KEY: z.string(),
  ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-'),
  CORS_ORIGIN: z.string().default('*'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // ── Kanji Buddy LLM router configuration ──────────────────────────────
  // All optional / defaulted so local dev works with just ANTHROPIC_API_KEY.
  // The router's tier 2 path requires at least one of GROQ_API_KEY or
  // GEMINI_API_KEY to be set for generation to actually succeed; the
  // providers themselves report isAvailable()=false when their key is
  // missing, at which point the router surfaces a tier 2 failure.
  GROQ_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  BUDDY_TIER2_DAILY_CAP_PER_USER: z.coerce.number().int().positive().default(50),
  BUDDY_TIER3_DAILY_CAP_PER_USER: z.coerce.number().int().positive().default(5),
  LLM_PRIMARY_TIER2_PROVIDER: z.enum(['groq', 'gemini']).default('groq'),
  LLM_SECONDARY_TIER2_PROVIDER: z.enum(['groq', 'gemini']).default('gemini'),
}).refine(
  (env) => env.LLM_PRIMARY_TIER2_PROVIDER !== env.LLM_SECONDARY_TIER2_PROVIDER,
  {
    // Router fail-over relies on diversity. If both slots point at the same
    // provider, a rate-limit or auth failure on one call compounds instead
    // of recovering, and the telemetry for both attempts is indistinguishable.
    message:
      'LLM_PRIMARY_TIER2_PROVIDER and LLM_SECONDARY_TIER2_PROVIDER must differ — router fail-over needs two distinct providers.',
    path: ['LLM_SECONDARY_TIER2_PROVIDER'],
  }
)

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Invalid environment variables:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
