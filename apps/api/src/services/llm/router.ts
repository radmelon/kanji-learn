import type {
  CompletionRequest,
  CompletionResult,
  LLMProvider,
  Message,
} from '@kanji-learn/shared'
import { BuddyLLMError, classifyTier } from './types'
import type { BuddyRequest } from './types'

/**
 * Lightweight interface — the concrete implementation lives in `rate-limit.ts`,
 * but the router only needs these two methods. Defining it here keeps the
 * router decoupled from the db-backed `RateLimiter` for easy testing.
 */
export interface RateLimiterLike {
  tryConsume(userId: string, tier: 1 | 2 | 3): Promise<boolean>
  remainingForTier(userId: string, tier: 2 | 3): Promise<number>
}

export interface TelemetryEvent {
  userId: string
  tier: 1 | 2 | 3
  providerName: string
  requestContext: string
  inputTokens: number
  outputTokens: number
  latencyMs: number
  success: boolean
  errorCode?: string
}

export type EmitTelemetry = (event: TelemetryEvent) => void | Promise<void>

/**
 * Sanitized error classification used in telemetry. We deliberately do NOT
 * forward raw `err.message` to the telemetry sink because provider error
 * messages can embed credentials, prompt content, or PII. The full error
 * remains available via `BuddyLLMError.cause` for in-process debugging; the
 * telemetry channel only sees a coarse category.
 */
export type RouterErrorCode =
  | 'unavailable'
  | 'rate_limited'
  | 'auth_failed'
  | 'rate_limit_upstream'
  | 'timeout'
  | 'context_overflow'
  | 'safety'
  | 'unknown'

function classifyError(err: unknown): RouterErrorCode {
  if (!(err instanceof Error)) return 'unknown'
  const msg = err.message.toLowerCase()
  // Match the (HTTP NNN) suffix the providers attach via APIError extraction.
  const httpMatch = msg.match(/http (\d{3})/)
  if (httpMatch) {
    const status = Number(httpMatch[1])
    if (status === 401 || status === 403) return 'auth_failed'
    if (status === 429) return 'rate_limit_upstream'
    if (status === 408 || status === 504) return 'timeout'
  }
  if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout'
  if (msg.includes('safety') || msg.includes('blocked')) return 'safety'
  if (msg.includes('context') && msg.includes('length')) return 'context_overflow'
  return 'unknown'
}

export interface BuddyLLMRouterOptions {
  onDevice: LLMProvider
  tier2Primary: LLMProvider
  tier2Secondary: LLMProvider
  tier3: LLMProvider
  rateLimiter: RateLimiterLike
  emitTelemetry: EmitTelemetry
  defaultMaxTokens?: number
  defaultTemperature?: number
}

/**
 * Orchestrator for the three-tier Buddy LLM stack.
 *
 * Responsibilities:
 *   1. Classify each `BuddyRequest` into tier 1/2/3 via `classifyTier`.
 *   2. Walk the tier chain with fail-over (on-device → tier 2 primary →
 *      secondary; tier 3 → tier 2; etc.).
 *   3. Consult the rate limiter before every paid-tier attempt and fall
 *      through to the next lower tier when capped (tier 1 is unlimited).
 *   4. Truncate the assembled prompt to fit the chosen provider's
 *      `maxContextTokens` budget while keeping the system prompt intact.
 *   5. Emit a telemetry record for every attempt — success or failure —
 *      while never letting telemetry errors break user-facing calls.
 */
export class BuddyLLMRouter {
  constructor(private readonly opts: BuddyLLMRouterOptions) {}

  /**
   * Route a `BuddyRequest` through the tier chain with rate limiting and
   * fail-over. Throws `BuddyLLMError` only when no provider in any reachable
   * tier can service the request.
   */
  async route(request: BuddyRequest): Promise<CompletionResult> {
    const tier = classifyTier(request)

    // Tier 1 → try on-device; fall through to tier 2 primary on failure/unavail.
    // Any swallowed error from the on-device path is threaded into runTier2 so
    // the final BuddyLLMError.cause (if both tier 2 providers also fail)
    // carries the full chain for debugging.
    if (tier === 1) {
      const { result, error } = await this.tryOnDevice(request)
      if (result) return result
      return this.runTier2(request, { upstreamError: error, upstreamTier: 1 })
    }

    // Tier 3 → try Claude if opted in; fall through to tier 2
    if (tier === 3) {
      if (request.userOptedInPremium === true) {
        const { result, error } = await this.tryClaude(request)
        if (result) return result
        return this.runTier2(request, { upstreamError: error, upstreamTier: 3 })
      }
      return this.runTier2(request)
    }

    // Tier 2 (default)
    return this.runTier2(request)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Per-tier attempts
  // ─────────────────────────────────────────────────────────────────────────

  private async tryOnDevice(
    request: BuddyRequest
  ): Promise<{ result?: CompletionResult; error?: unknown }> {
    const provider = this.opts.onDevice
    // Tier 1 is not rate-limited; no consume call needed.
    let available = false
    try {
      available = await provider.isAvailable()
    } catch (err) {
      // isAvailable throwing counts as unavailable. Still emit a skip event
      // so dashboards can see on-device churn. The caught error is returned
      // so runTier2 can fold it into a final cause-chain if nothing else
      // succeeds.
      await this.emitSkip(request, provider, 1, 'unavailable')
      return { error: err }
    }
    if (!available) {
      // Emit a zero-cost "unavailable" event so we can measure on-device
      // coverage in Phase 1 dashboards. This is a real attempt that was
      // cleanly declined, not a silent skip.
      await this.emitSkip(request, provider, 1, 'unavailable')
      return {}
    }
    // Generation errors also fall through to tier 2 — the on-device provider
    // is best-effort. `callProvider` emits its own failure telemetry, so we
    // don't double-emit here.
    try {
      const result = await this.callProvider(provider, request, 1)
      return { result }
    } catch (err) {
      return { error: err }
    }
  }

  private async tryClaude(
    request: BuddyRequest
  ): Promise<{ result?: CompletionResult; error?: unknown }> {
    const provider = this.opts.tier3
    // Rate limit consult is atomic with consumption — a slot used here is
    // never refunded even if the call below throws. That's intentional: a
    // failed-but-attempted Claude call still counts toward the daily cap.
    const allowed = await this.opts.rateLimiter.tryConsume(request.userId, 3)
    if (!allowed) {
      // Emit a zero-cost rate_limited event so Phase 1 dashboards can track
      // tier 3 cap hits — arguably the most important metric in the whole
      // stack for justifying the upsell / raising caps.
      await this.emitSkip(request, provider, 3, 'rate_limited')
      return {}
    }
    try {
      const result = await this.callProvider(provider, request, 3)
      return { result }
    } catch (err) {
      return { error: err }
    }
  }

  /**
   * Emit a zero-cost "soft skip" telemetry event for a provider that was
   * consulted but not called — either because it reported unavailable or
   * because the rate limiter rejected the slot. These events carry no
   * token counts and near-zero latency, but they're essential for
   * dashboarding on-device coverage and tier 3 cap hit rate.
   */
  private async emitSkip(
    request: BuddyRequest,
    provider: LLMProvider,
    tier: 1 | 2 | 3,
    errorCode: RouterErrorCode
  ): Promise<void> {
    await this.safeEmit({
      userId: request.userId,
      tier,
      providerName: provider.name,
      requestContext: request.context,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      success: false,
      errorCode,
    })
  }

  private async runTier2(
    request: BuddyRequest,
    upstream?: { upstreamError?: unknown; upstreamTier?: 1 | 3 }
  ): Promise<CompletionResult> {
    const allowed = await this.opts.rateLimiter.tryConsume(request.userId, 2)
    if (!allowed) {
      throw new BuddyLLMError('Tier 2 daily cap reached; no lower tier available', {
        // Preserve any upstream error from tier 1 / tier 3 so the caller can
        // trace the whole fall-through chain.
        upstream: upstream?.upstreamError,
        upstreamTier: upstream?.upstreamTier,
      })
    }

    // Try primary
    try {
      return await this.callProvider(this.opts.tier2Primary, request, 2)
    } catch (primaryErr) {
      // Secondary attempt — does not consume an additional quota slot
      try {
        return await this.callProvider(this.opts.tier2Secondary, request, 2)
      } catch (secondaryErr) {
        throw new BuddyLLMError('Both tier 2 providers failed', {
          primary: primaryErr,
          secondary: secondaryErr,
          // Include the upstream error from tier 1 / tier 3 if we fell
          // through into tier 2 — otherwise a Claude failure followed by
          // two tier 2 failures would lose the Claude error entirely.
          upstream: upstream?.upstreamError,
          upstreamTier: upstream?.upstreamTier,
        })
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Single provider call (with truncation + telemetry)
  // ─────────────────────────────────────────────────────────────────────────

  private async callProvider(
    provider: LLMProvider,
    request: BuddyRequest,
    tier: 1 | 2 | 3
  ): Promise<CompletionResult> {
    const completionRequest = this.buildCompletionRequest(provider, request)
    const started = Date.now()
    try {
      const result = await provider.generateCompletion(completionRequest)
      // Trust the provider's self-reported latency only when it's a
      // non-negative number. A legitimate 0 (cache hit) should NOT be
      // overwritten — the previous `||` short-circuit did so, breaking the
      // distinction between "provider reported instant" and "provider failed
      // to report." Router-side timing is used only when the provider's
      // value is absent or obviously invalid.
      const providerLatency = result.latencyMs
      const latencyMs =
        typeof providerLatency === 'number' && providerLatency >= 0
          ? providerLatency
          : Date.now() - started
      await this.safeEmit({
        userId: request.userId,
        tier,
        providerName: provider.name,
        requestContext: request.context,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs,
        success: true,
      })
      return result
    } catch (err) {
      await this.safeEmit({
        userId: request.userId,
        tier,
        providerName: provider.name,
        requestContext: request.context,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - started,
        success: false,
        // Sanitized classification only — raw err.message may contain API
        // keys, prompt text, or PII and must not reach the telemetry sink.
        // Full error remains available via BuddyLLMError.cause.
        errorCode: classifyError(err),
      })
      throw err
    }
  }

  private buildCompletionRequest(
    provider: LLMProvider,
    request: BuddyRequest
  ): CompletionRequest {
    const truncated = this.truncateForContext(
      request.systemPrompt,
      request.messages,
      provider.maxContextTokens
    )
    const completion: CompletionRequest = {
      messages: truncated,
      maxTokens: request.maxTokens ?? this.opts.defaultMaxTokens ?? 1024,
      temperature: request.temperature ?? this.opts.defaultTemperature ?? 0.7,
    }
    if (request.systemPrompt !== undefined) {
      completion.systemPrompt = request.systemPrompt
    }
    if (request.tools !== undefined) {
      completion.tools = request.tools
    }
    return completion
  }

  /**
   * Crude token estimate — 1 token ≈ 4 characters for English, which is
   * accurate enough for truncation decisions. Drops the earliest non-system
   * messages until the estimate fits under `maxContextTokens * 0.75` to leave
   * headroom for the model's response.
   *
   * Accepts `readonly Message[]` because `BuddyRequest.messages` is readonly,
   * but always returns a fresh mutable `Message[]` so the caller can hand it
   * straight to `CompletionRequest.messages` (which is mutable).
   */
  truncateForContext(
    systemPrompt: string | undefined,
    messages: readonly Message[],
    maxContextTokens: number
  ): Message[] {
    const budget = Math.floor(maxContextTokens * 0.75)
    const systemCost = systemPrompt ? estimateTokens(systemPrompt) : 0

    const result: Message[] = [...messages]
    while (estimateMessagesTokens(result) + systemCost > budget && result.length > 1) {
      result.shift()
    }
    return result
  }

  private async safeEmit(event: TelemetryEvent): Promise<void> {
    try {
      await this.opts.emitTelemetry(event)
    } catch {
      // Never let telemetry failures break a user-facing call.
    }
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function estimateMessagesTokens(messages: readonly Message[]): number {
  let total = 0
  for (const m of messages) {
    if (m.role === 'system' || m.role === 'user') {
      total += estimateTokens(m.content)
    } else if (m.role === 'assistant') {
      total += estimateTokens(m.content ?? '')
    } else if (m.role === 'tool') {
      for (const r of m.toolResults) {
        total +=
          typeof r.content === 'string'
            ? estimateTokens(r.content)
            : estimateTokens(JSON.stringify(r.content))
      }
    }
  }
  return total
}
