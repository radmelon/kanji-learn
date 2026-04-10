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

    // Tier 1 → try on-device; fall through to tier 2 primary on failure/unavail
    if (tier === 1) {
      const viaOnDevice = await this.tryOnDevice(request)
      if (viaOnDevice) return viaOnDevice
      return this.runTier2(request)
    }

    // Tier 3 → try Claude if opted in; fall through to tier 2
    if (tier === 3) {
      if (request.userOptedInPremium === true) {
        const viaClaude = await this.tryClaude(request)
        if (viaClaude) return viaClaude
      }
      return this.runTier2(request)
    }

    // Tier 2 (default)
    return this.runTier2(request)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Per-tier attempts
  // ─────────────────────────────────────────────────────────────────────────

  private async tryOnDevice(request: BuddyRequest): Promise<CompletionResult | null> {
    const provider = this.opts.onDevice
    // Tier 1 is not rate-limited; no consume call needed.
    try {
      if (!(await provider.isAvailable())) return null
    } catch {
      return null
    }
    // Catch errors from the actual generation too — the on-device provider
    // is best-effort and any failure should fall through to tier 2.
    try {
      return await this.callProvider(provider, request, 1)
    } catch {
      return null
    }
  }

  private async tryClaude(request: BuddyRequest): Promise<CompletionResult | null> {
    const provider = this.opts.tier3
    // Rate limit consult is atomic with consumption — a slot used here is
    // never refunded even if the call below throws. That's intentional: a
    // failed-but-attempted Claude call still counts toward the daily cap.
    const allowed = await this.opts.rateLimiter.tryConsume(request.userId, 3)
    if (!allowed) return null
    try {
      return await this.callProvider(provider, request, 3)
    } catch {
      return null
    }
  }

  private async runTier2(request: BuddyRequest): Promise<CompletionResult> {
    const allowed = await this.opts.rateLimiter.tryConsume(request.userId, 2)
    if (!allowed) {
      throw new BuddyLLMError('Tier 2 daily cap reached; no lower tier available')
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
      await this.safeEmit({
        userId: request.userId,
        tier,
        providerName: provider.name,
        requestContext: request.context,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs || Date.now() - started,
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
        errorCode: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
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
