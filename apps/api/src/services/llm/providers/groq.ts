import Groq, { APIError } from 'groq-sdk'
import type {
  CompletionRequest,
  CompletionResult,
  FinishReason,
  LLMProvider,
} from '@kanji-learn/shared'
import { BuddyLLMError } from '../types'

export interface GroqProviderOptions {
  apiKey: string
  model?: string
}

const DEFAULT_MODEL = 'llama-3.3-70b-versatile'

/**
 * Tier 1 provider: Llama-3.3-70b-versatile via Groq.
 *
 * **Latency semantics:** `latencyMs` in `CompletionResult` reflects the
 * successful call's wall-clock time. On error, the provider does not attach
 * latency — the router (Task 14) is responsible for timing its own try/catch
 * boundary for telemetry so that `buddy_llm_telemetry.latency_ms` is
 * populated for failure rows.
 *
 * **Tool calling:** `supportsToolCalling` is true because the Groq Llama
 * model does support it, but Phase 0 does not parse `choice.message.tool_calls`
 * into `CompletionResult.toolCalls`. Callers that send `request.tools` will
 * receive `finishReason: 'tool_use'` with no tool calls populated. Tool-call
 * round-trips are Phase 1 work.
 */
export class GroqProvider implements LLMProvider {
  readonly name = 'groq'
  readonly supportsToolCalling = true
  readonly maxContextTokens = 128_000
  /** ~p50 for a 500-token Llama-3.3-70b completion on Groq free tier. */
  readonly estimatedLatencyMs = 400
  readonly costPerInputToken = 0
  readonly costPerOutputToken = 0

  private client: Groq | undefined
  private model: string

  constructor(private options: GroqProviderOptions) {
    this.model = options.model ?? DEFAULT_MODEL
    // Defer SDK construction: the Groq SDK throws synchronously in its
    // constructor when apiKey is undefined, which would bypass
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
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
      if (request.systemPrompt) {
        messages.push({ role: 'system', content: request.systemPrompt })
      }
      for (const m of request.messages) {
        if (m.role === 'tool') continue // Phase 1 will handle tool-result round-trips
        // After the `tool` skip, m.role is narrowed to system | user | assistant,
        // all of which have `content: string` in the shared Message union.
        messages.push({ role: m.role, content: m.content })
      }

      const response = await client.chat.completions.create({
        model: this.model,
        messages,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
      })

      if (!response.choices || response.choices.length === 0) {
        throw new BuddyLLMError('Groq returned no choices')
      }

      const choice = response.choices[0]
      return {
        // Preserve the distinction between "empty string" and "no text at all"
        // (e.g., a pure tool-call response has null content). The shared
        // CompletionResult.content type is optional for this reason.
        content: choice?.message?.content ?? undefined,
        finishReason: this.mapFinishReason(choice?.finish_reason ?? null),
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        providerName: this.name,
        latencyMs: Date.now() - start,
      }
    } catch (err) {
      // BuddyLLMError should not be double-wrapped — re-throw ones we threw above.
      if (err instanceof BuddyLLMError) throw err
      const status = err instanceof APIError ? err.status : undefined
      const suffix = status !== undefined ? ` (HTTP ${status})` : ''
      throw new BuddyLLMError(`Groq request failed${suffix}`, err)
    }
  }

  private getClient(): Groq {
    if (!this.client) {
      if (!this.options.apiKey) {
        throw new BuddyLLMError('Groq request failed: api key is missing')
      }
      this.client = new Groq({ apiKey: this.options.apiKey })
    }
    return this.client
  }

  private mapFinishReason(raw: string | null): FinishReason {
    switch (raw) {
      case 'stop':
        return 'stop'
      case 'length':
        return 'length'
      case 'tool_calls':
        return 'tool_use'
      case 'content_filter':
        return 'safety'
      default:
        return 'stop'
    }
  }
}
