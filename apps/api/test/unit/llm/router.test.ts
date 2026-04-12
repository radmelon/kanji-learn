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
    // Zero-cost skip event for on-device unavailable + success event for groq.
    // We dashboard on-device coverage via these skip events, so they must fire.
    expect(telemetrySpy).toHaveBeenCalledTimes(2)
    expect(telemetrySpy.mock.calls[0]?.[0]).toMatchObject({
      providerName: 'apple-fm',
      tier: 1,
      success: false,
      errorCode: 'unavailable',
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    })
    expect(telemetrySpy.mock.calls[1]?.[0]).toMatchObject({
      providerName: 'groq',
      tier: 2,
      success: true,
    })
  })

  it('falls through to tier 2 when the on-device provider throws during generation', async () => {
    // Regression guard: generateCompletion can throw after isAvailable returns
    // true (e.g. transient model load failure). The router must catch, emit
    // failure telemetry for the on-device attempt, and still serve the
    // request via tier 2.
    const onDevice = makeProvider('apple-fm', { available: true, shouldFail: true })
    const primary = makeProvider('groq', { content: 'from groq' })

    const router = new BuddyLLMRouter({
      onDevice,
      tier2Primary: primary,
      tier2Secondary: makeProvider('gemini'),
      tier3: makeProvider('claude'),
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    const result = await router.route(baseRequest({ context: 'encouragement' }))
    expect(result.providerName).toBe('groq')
    // Failure event for apple-fm (real attempt, not a skip) + success for groq.
    expect(telemetrySpy).toHaveBeenCalledTimes(2)
    expect(telemetrySpy.mock.calls[0]?.[0]).toMatchObject({
      providerName: 'apple-fm',
      tier: 1,
      success: false,
    })
    // Crucially, errorCode must be a classified enum, NOT the raw error
    // message — provider messages can leak API keys or PII.
    const appleCall = telemetrySpy.mock.calls[0]?.[0] as { errorCode: string }
    expect(appleCall.errorCode).not.toContain('apple-fm failed')
    expect(['unknown', 'timeout', 'auth_failed', 'rate_limit_upstream', 'context_overflow', 'safety']).toContain(
      appleCall.errorCode
    )
  })

  it('threads a tier 1 generation error into the final BuddyLLMError cause', async () => {
    // If tier 1 throws and both tier 2 providers also fail, the router must
    // preserve the tier 1 error in the cause chain — otherwise the debugging
    // story for "everything broke" is incomplete.
    const onDevice = makeProvider('apple-fm', { available: true, shouldFail: true })
    const primary = makeProvider('groq', { shouldFail: true })
    const secondary = makeProvider('gemini', { shouldFail: true })

    const router = new BuddyLLMRouter({
      onDevice,
      tier2Primary: primary,
      tier2Secondary: secondary,
      tier3: makeProvider('claude'),
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    let thrown: unknown
    try {
      await router.route(baseRequest({ context: 'encouragement' }))
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(BuddyLLMError)
    const cause = (thrown as BuddyLLMError).cause as {
      primary?: Error
      secondary?: Error
      upstream?: Error
      upstreamTier?: number
    }
    expect(cause.primary).toBeInstanceOf(Error)
    expect(cause.secondary).toBeInstanceOf(Error)
    expect(cause.upstream).toBeInstanceOf(Error)
    expect(cause.upstreamTier).toBe(1)
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
    // Should consult tryConsume for tier 3 first, then tier 2 on fallthrough —
    // and must NOT consult for tier 1 (tier 1 is unlimited by design).
    expect(rateLimiter.tryConsume).toHaveBeenCalledTimes(2)
    expect(rateLimiter.tryConsume).toHaveBeenNthCalledWith(1, 'user-1', 3)
    expect(rateLimiter.tryConsume).toHaveBeenNthCalledWith(2, 'user-1', 2)
    // Zero-cost skip event for claude rate limit so dashboards can track
    // tier 3 cap hits — the most important metric for upsell justification.
    const claudeSkip = telemetrySpy.mock.calls.find(
      (c) => (c[0] as { providerName: string }).providerName === 'claude'
    )
    expect(claudeSkip?.[0]).toMatchObject({
      providerName: 'claude',
      tier: 3,
      success: false,
      errorCode: 'rate_limited',
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    })
  })

  it('does not consult the rate limiter for tier 1 on-device calls', async () => {
    // Tier 1 is unlimited. The rate limiter must only be consulted when we
    // need to charge a paid-tier slot (tier 2 or tier 3).
    const router = new BuddyLLMRouter({
      onDevice: makeProvider('apple-fm', { available: true, content: 'from device' }),
      tier2Primary: makeProvider('groq'),
      tier2Secondary: makeProvider('gemini'),
      tier3: makeProvider('claude'),
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    const result = await router.route(baseRequest({ context: 'encouragement' }))
    expect(result.providerName).toBe('apple-fm')
    expect(rateLimiter.tryConsume).not.toHaveBeenCalled()
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

  it('respects the 0.75 budget floor with headroom for the response', async () => {
    // Direct unit test of truncateForContext: 1 token ≈ 4 chars, budget is
    // floor(maxContextTokens * 0.75), and the loop drops earliest messages
    // until total fits. With maxContextTokens=100, budget=75 tokens = 300
    // chars. A system prompt of 40 chars (10 tokens) leaves 65 tokens (260
    // chars) of messages budget.
    const router = new BuddyLLMRouter({
      onDevice: makeProvider('apple-fm', { available: false }),
      tier2Primary: makeProvider('groq'),
      tier2Secondary: makeProvider('gemini'),
      tier3: makeProvider('claude'),
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    // 40 chars → 10 tokens
    const systemPrompt = 'A'.repeat(40)
    // Each message is 80 chars → 20 tokens. Five of them = 100 tokens.
    // With system=10, total=110, budget=75 → router must drop until ≤75.
    const messages = Array.from({ length: 5 }, (_, i) => ({
      role: 'user' as const,
      content: ('msg' + i + ' ').padEnd(80, 'x'),
    }))

    const truncated = router.truncateForContext(systemPrompt, messages, 100)
    // System cost (10) + kept messages must fit under 75.
    const keptChars = truncated.reduce((sum, m) => {
      if (m.role === 'user' || m.role === 'system') return sum + m.content.length
      if (m.role === 'assistant') return sum + (m.content?.length ?? 0)
      return sum
    }, 0)
    const keptTokens = Math.ceil(keptChars / 4)
    expect(keptTokens + 10).toBeLessThanOrEqual(75)
    // Must always keep at least one message (the most recent) — never drop
    // down to an empty array, even if it would technically exceed the budget.
    expect(truncated.length).toBeGreaterThanOrEqual(1)
    // Most recent message preserved.
    expect((truncated.at(-1) as { content: string }).content).toContain('msg4')
  })
})

describe('BuddyLLMRouter — telemetry latency', () => {
  it('preserves a provider-reported latency of 0 instead of overwriting with wall-clock', async () => {
    // Regression guard: the old `result.latencyMs || Date.now() - started`
    // short-circuit erased legitimate 0 values (e.g. cache hits), breaking
    // the distinction between "provider reported instant" and "provider
    // failed to report".
    const zeroLatencyProvider: LLMProvider = {
      ...makeProvider('zero'),
      async generateCompletion() {
        return {
          content: 'instant',
          finishReason: 'stop',
          inputTokens: 1,
          outputTokens: 1,
          providerName: 'zero',
          latencyMs: 0,
        }
      },
    }

    const router = new BuddyLLMRouter({
      onDevice: makeProvider('apple-fm', { available: false }),
      tier2Primary: zeroLatencyProvider,
      tier2Secondary: makeProvider('gemini'),
      tier3: makeProvider('claude'),
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    await router.route(baseRequest({ context: 'leech_diagnostic' }))
    const call = telemetrySpy.mock.calls[0]?.[0] as { latencyMs: number }
    expect(call.latencyMs).toBe(0)
  })
})
