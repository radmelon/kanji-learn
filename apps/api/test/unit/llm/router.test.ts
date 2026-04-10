import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  CompletionRequest,
  CompletionResult,
  LLMProvider,
} from '@kanji-learn/shared'
import { BuddyLLMRouter } from '../../../src/services/llm/router'
import { BuddyLLMError } from '../../../src/services/llm/types'
import type { BuddyRequest } from '../../../src/services/llm/types'

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function makeProvider(
  name: string,
  opts: Partial<LLMProvider> & {
    available?: boolean
    shouldFail?: boolean
    content?: string
  } = {}
): LLMProvider {
  return {
    name,
    supportsToolCalling: opts.supportsToolCalling ?? false,
    maxContextTokens: opts.maxContextTokens ?? 8_000,
    estimatedLatencyMs: opts.estimatedLatencyMs ?? 100,
    costPerInputToken: opts.costPerInputToken ?? 0,
    costPerOutputToken: opts.costPerOutputToken ?? 0,
    async isAvailable() {
      return opts.available ?? true
    },
    async generateCompletion(_req: CompletionRequest): Promise<CompletionResult> {
      if (opts.shouldFail) throw new Error(`${name} failed`)
      return {
        content: opts.content ?? `from ${name}`,
        finishReason: 'stop',
        inputTokens: 10,
        outputTokens: 5,
        providerName: name,
        latencyMs: 42,
      }
    },
  }
}

const telemetrySpy = vi.fn()
const rateLimiter = {
  tryConsume: vi.fn(async (_uid: string, _tier: 1 | 2 | 3) => true),
  remainingForTier: vi.fn(async (_uid: string, _tier: 2 | 3) => 10),
}

function baseRequest(overrides: Partial<BuddyRequest> = {}): BuddyRequest {
  return {
    context: 'encouragement',
    userId: 'user-1',
    systemPrompt: 'You are Buddy.',
    messages: [{ role: 'user', content: 'Hi' }],
    ...overrides,
  }
}

beforeEach(() => {
  telemetrySpy.mockReset()
  rateLimiter.tryConsume.mockReset()
  rateLimiter.tryConsume.mockResolvedValue(true)
})

// ───────────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────────

describe('BuddyLLMRouter — tier 1', () => {
  it('uses the on-device provider when available', async () => {
    const onDevice = makeProvider('apple-fm', { available: true, content: 'from device' })
    const primary = makeProvider('groq')
    const secondary = makeProvider('gemini')
    const claude = makeProvider('claude')

    const router = new BuddyLLMRouter({
      onDevice,
      tier2Primary: primary,
      tier2Secondary: secondary,
      tier3: claude,
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    const result = await router.route(baseRequest({ context: 'encouragement' }))
    expect(result.content).toBe('from device')
    expect(result.providerName).toBe('apple-fm')
  })

  it('falls through to tier 2 primary when on-device is unavailable', async () => {
    const onDevice = makeProvider('apple-fm', { available: false })
    const primary = makeProvider('groq', { content: 'from groq' })
    const secondary = makeProvider('gemini')
    const claude = makeProvider('claude')

    const router = new BuddyLLMRouter({
      onDevice,
      tier2Primary: primary,
      tier2Secondary: secondary,
      tier3: claude,
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    const result = await router.route(baseRequest({ context: 'encouragement' }))
    expect(result.providerName).toBe('groq')
  })
})

describe('BuddyLLMRouter — tier 2', () => {
  it('uses the primary provider on success', async () => {
    const router = new BuddyLLMRouter({
      onDevice: makeProvider('apple-fm', { available: false }),
      tier2Primary: makeProvider('groq', { content: 'g' }),
      tier2Secondary: makeProvider('gemini', { content: 'x' }),
      tier3: makeProvider('claude'),
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    const result = await router.route(baseRequest({ context: 'study_plan_generation' }))
    expect(result.providerName).toBe('groq')
  })

  it('falls over to the secondary provider if primary throws', async () => {
    const router = new BuddyLLMRouter({
      onDevice: makeProvider('apple-fm', { available: false }),
      tier2Primary: makeProvider('groq', { shouldFail: true }),
      tier2Secondary: makeProvider('gemini', { content: 'from gemini' }),
      tier3: makeProvider('claude'),
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    const result = await router.route(baseRequest({ context: 'leech_diagnostic' }))
    expect(result.providerName).toBe('gemini')
    // Two telemetry emits: one failure for groq, one success for gemini
    expect(telemetrySpy).toHaveBeenCalledTimes(2)
    expect(telemetrySpy.mock.calls[0]?.[0]).toMatchObject({ providerName: 'groq', success: false })
    expect(telemetrySpy.mock.calls[1]?.[0]).toMatchObject({ providerName: 'gemini', success: true })
  })

  it('throws BuddyLLMError when both tier 2 providers fail', async () => {
    const router = new BuddyLLMRouter({
      onDevice: makeProvider('apple-fm', { available: false }),
      tier2Primary: makeProvider('groq', { shouldFail: true }),
      tier2Secondary: makeProvider('gemini', { shouldFail: true }),
      tier3: makeProvider('claude'),
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    await expect(router.route(baseRequest({ context: 'leech_diagnostic' }))).rejects.toBeInstanceOf(
      BuddyLLMError
    )
  })
})

describe('BuddyLLMRouter — tier 3', () => {
  it('uses Claude when user has opted in', async () => {
    const router = new BuddyLLMRouter({
      onDevice: makeProvider('apple-fm', { available: false }),
      tier2Primary: makeProvider('groq'),
      tier2Secondary: makeProvider('gemini'),
      tier3: makeProvider('claude', { content: 'from claude' }),
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    const result = await router.route(
      baseRequest({ context: 'mnemonic_cocreation', userOptedInPremium: true })
    )
    expect(result.providerName).toBe('claude')
  })

  it('falls through to tier 2 when user has NOT opted in', async () => {
    const router = new BuddyLLMRouter({
      onDevice: makeProvider('apple-fm', { available: false }),
      tier2Primary: makeProvider('groq', { content: 'from groq' }),
      tier2Secondary: makeProvider('gemini'),
      tier3: makeProvider('claude', { content: 'from claude' }),
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    const result = await router.route(
      baseRequest({ context: 'mnemonic_cocreation', userOptedInPremium: false })
    )
    expect(result.providerName).toBe('groq')
  })

  it('falls through to tier 2 when Claude fails', async () => {
    const router = new BuddyLLMRouter({
      onDevice: makeProvider('apple-fm', { available: false }),
      tier2Primary: makeProvider('groq', { content: 'from groq' }),
      tier2Secondary: makeProvider('gemini'),
      tier3: makeProvider('claude', { shouldFail: true }),
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    const result = await router.route(
      baseRequest({ context: 'deep_diagnostic', userOptedInPremium: true })
    )
    expect(result.providerName).toBe('groq')
  })
})

describe('BuddyLLMRouter — rate limiting', () => {
  it('falls through to tier 2 when tier 3 is rate limited', async () => {
    rateLimiter.tryConsume.mockImplementation(async (_uid: string, tier: 1 | 2 | 3) => tier !== 3)

    const router = new BuddyLLMRouter({
      onDevice: makeProvider('apple-fm', { available: false }),
      tier2Primary: makeProvider('groq', { content: 'from groq' }),
      tier2Secondary: makeProvider('gemini'),
      tier3: makeProvider('claude', { content: 'from claude' }),
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    const result = await router.route(
      baseRequest({ context: 'deep_diagnostic', userOptedInPremium: true })
    )
    expect(result.providerName).toBe('groq')
  })

  it('throws BuddyLLMError when all tiers are rate limited', async () => {
    rateLimiter.tryConsume.mockResolvedValue(false)

    const router = new BuddyLLMRouter({
      onDevice: makeProvider('apple-fm', { available: false }),
      tier2Primary: makeProvider('groq'),
      tier2Secondary: makeProvider('gemini'),
      tier3: makeProvider('claude'),
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    await expect(
      router.route(baseRequest({ context: 'leech_diagnostic' }))
    ).rejects.toBeInstanceOf(BuddyLLMError)
  })
})

describe('BuddyLLMRouter — truncation', () => {
  it('drops the earliest non-system messages when over the cap', async () => {
    const captured: CompletionRequest[] = []
    const tinyProvider: LLMProvider = {
      ...makeProvider('tiny', { maxContextTokens: 20 }),
      async generateCompletion(req) {
        captured.push(req)
        return {
          content: 'ok',
          finishReason: 'stop',
          inputTokens: 5,
          outputTokens: 5,
          providerName: 'tiny',
          latencyMs: 1,
        }
      },
    }

    const router = new BuddyLLMRouter({
      onDevice: makeProvider('apple-fm', { available: false }),
      tier2Primary: tinyProvider,
      tier2Secondary: makeProvider('gemini'),
      tier3: makeProvider('claude'),
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    // Build a request with many long messages
    const longMessages = Array.from({ length: 10 }, (_, i) => ({
      role: 'user' as const,
      content: 'this is a long message number ' + i + ' filler filler filler',
    }))

    await router.route(
      baseRequest({
        context: 'study_plan_generation',
        systemPrompt: 'SYS',
        messages: longMessages,
      })
    )

    const sent = captured[0]
    expect(sent).toBeDefined()
    // System prompt preserved
    expect(sent!.systemPrompt).toBe('SYS')
    // Fewer messages than we sent in
    expect(sent!.messages.length).toBeLessThan(longMessages.length)
    // The last message is still present (most recent)
    expect((sent!.messages.at(-1) as { content: string }).content).toContain('9')
  })
})
