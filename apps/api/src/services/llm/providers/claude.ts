import Anthropic, { APIError } from '@anthropic-ai/sdk'
import type {
  CompletionRequest,
  CompletionResult,
  FinishReason,
  LLMProvider,
} from '@kanji-learn/shared'
import { BuddyLLMError } from '../types'

export interface ClaudeProviderOptions {
  apiKey: string
  model?: string
}

// TODO: before live deployment, confirm the exact alias format. Anthropic's
// pattern is typically `claude-sonnet-4-6-<yyyymmdd>` with a `-latest` alias
// after a model has been GA'd. The bare `claude-sonnet-4-6` string works as
// an alias on some Anthropic endpoints but not others; the router's integration
// smoke test (Task 24) will surface any 404. Override via ClaudeProviderOptions.model
// if needed.
const DEFAULT_MODEL = 'claude-sonnet-4-6'

/**
 * Tier 3 provider: Claude Sonnet 4.6 via @anthropic-ai/sdk.
 *
 * **Latency semantics:** `latencyMs` in `CompletionResult` reflects the
 * successful call's wall-clock time. On error, the provider does not attach
 * latency — the router (Task 14) is responsible for timing its own try/catch
 * boundary for telemetry so that `buddy_llm_telemetry.latency_ms` is
 * populated for failure rows.
 *
 * **Tool calling:** `supportsToolCalling` is true because Claude Sonnet 4.6
 * supports tool use, but Phase 0 does not parse the `tool_use` content blocks
 * into `CompletionResult.toolCalls`. Callers that send `request.tools` will
 * receive `finishReason: 'tool_use'` with no tool calls populated. Tool-call
 * round-trips are Phase 1 work.
 */
export class ClaudeProvider implements LLMProvider {
  readonly name = 'claude'
  readonly supportsToolCalling = true
  readonly maxContextTokens = 200_000
  /** ~p50 for a 500-token claude-sonnet-4-6 completion. */
  readonly estimatedLatencyMs = 1_200
  // TODO: verify Sonnet 4.6 pricing against anthropic.com/pricing. These
  // values ($3/MTok input, $15/MTok output) are the Sonnet 3.5/4 prices and
  // have historically held flat across Sonnet versions, but 4.6 should be
  // confirmed before the router's cost-based tiering (Task 14) goes live.
  readonly costPerInputToken = 0.000003
  readonly costPerOutputToken = 0.000015

  private client: Anthropic | undefined
  private model: string

  constructor(private options: ClaudeProviderOptions) {
    this.model = options.model ?? DEFAULT_MODEL
    // Defer SDK construction: the Anthropic SDK may throw synchronously in its
    // constructor when apiKey is missing/invalid, which would bypass
    // BuddyLLMError wrapping and escape the try/catch in generateCompletion.
    // Lazy init means an un-configured provider can still be constructed and
    // rejected cleanly via isAvailable().
  }

  async isAvailable(): Promise<boolean> {
    return typeof this.options.apiKey === 'string' && this.options.apiKey.length > 0
  }

  async generateCompletion(request: CompletionRequest): Promise<CompletionResult> {
    const start = Date.now()
    try {
      const client = this.getClient()

      // Claude's Messages API separates a top-level `system` field from the
      // turn-based `messages` array. We hoist any system messages embedded in
      // request.messages into the `system` field (joining with a double
      // newline so multiple system instructions are preserved) — Claude has
      // no per-turn system role.
      const systemParts: string[] = []
      if (request.systemPrompt) systemParts.push(request.systemPrompt)
      const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []
      for (const m of request.messages) {
        if (m.role === 'tool') continue // Phase 1 will handle tool-result round-trips
        if (m.role === 'system') {
          systemParts.push(m.content)
          continue
        }
        // After the skips, m.role is narrowed to user | assistant, both of
        // which have `content: string` in the shared Message union.
        messages.push({ role: m.role, content: m.content })
      }
      const system = systemParts.length > 0 ? systemParts.join('\n\n') : undefined

      // TODO(phase1): forward request.tools to messages.create and parse
      // tool_use content blocks into CompletionResult.toolCalls. Phase 0
      // intentionally drops request.tools — the class JSDoc documents this
      // gap. If tools are supplied, the provider still returns a sensible
      // result (the model just won't know tools exist).
      const response = await client.messages.create({
        model: this.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        system,
        messages,
      })

      if (!response.content || response.content.length === 0) {
        throw new BuddyLLMError('Claude returned no content blocks')
      }

      // Find the first text block, if any. Preserve the distinction between
      // "empty string" and "no text at all" (e.g. pure tool_use responses).
      const textBlock = response.content.find((b) => b.type === 'text')
      const text = textBlock && textBlock.type === 'text' ? textBlock.text : undefined

      // Detect tool-use responses defensively: if any content block has
      // type 'tool_use', override the finish reason regardless of what
      // stop_reason says. This handles future SDK versions where the two
      // could diverge, and mirrors the Gemini provider's pattern. Phase 0
      // does not populate CompletionResult.toolCalls — that's Phase 1.
      const hasToolUse = response.content.some((b) => b.type === 'tool_use')

      return {
        content: text && text.length > 0 ? text : undefined,
        finishReason: hasToolUse
          ? 'tool_use'
          : this.mapFinishReason(response.stop_reason ?? 'end_turn'),
        // The Anthropic SDK currently always returns usage, but guard with
        // optional chaining for parity with Groq/Gemini — a missing usage
        // field should not crash the provider.
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        providerName: this.name,
        latencyMs: Date.now() - start,
      }
    } catch (err) {
      // BuddyLLMError should not be double-wrapped — re-throw ones we threw above.
      if (err instanceof BuddyLLMError) throw err
      const status = err instanceof APIError ? err.status : undefined
      const suffix = status !== undefined ? ` (HTTP ${status})` : ''
      throw new BuddyLLMError(`Claude request failed${suffix}`, err)
    }
  }

  private getClient(): Anthropic {
    if (!this.client) {
      if (!this.options.apiKey) {
        throw new BuddyLLMError('Claude request failed: api key is missing')
      }
      this.client = new Anthropic({ apiKey: this.options.apiKey })
    }
    return this.client
  }

  private mapFinishReason(raw: string): FinishReason {
    switch (raw) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop'
      case 'max_tokens':
        return 'length'
      case 'tool_use':
        return 'tool_use'
      default:
        return 'stop'
    }
  }
}
