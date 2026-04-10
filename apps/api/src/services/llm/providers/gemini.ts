import {
  GoogleGenerativeAI,
  GoogleGenerativeAIFetchError,
  type GenerativeModel,
} from '@google/generative-ai'
import type {
  CompletionRequest,
  CompletionResult,
  FinishReason,
  LLMProvider,
} from '@kanji-learn/shared'
import { BuddyLLMError } from '../types'

export interface GeminiProviderOptions {
  apiKey: string
  model?: string
}

const DEFAULT_MODEL = 'gemini-2.5-flash'

/**
 * Tier 2 provider: Gemini 2.5 Flash via @google/generative-ai.
 *
 * **Latency semantics:** `latencyMs` in `CompletionResult` reflects the
 * successful call's wall-clock time. On error, the provider does not attach
 * latency — the router (Task 14) is responsible for timing its own try/catch
 * boundary for telemetry so that `buddy_llm_telemetry.latency_ms` is
 * populated for failure rows.
 *
 * **Tool calling:** `supportsToolCalling` is true because Gemini 2.5 Flash
 * supports function calling, but Phase 0 does not parse
 * `candidates[0].content.parts[].functionCall` into `CompletionResult.toolCalls`.
 * Callers that send `request.tools` will not receive populated tool calls.
 * Tool-call round-trips are Phase 1 work.
 */
export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini'
  readonly supportsToolCalling = true
  readonly maxContextTokens = 1_048_576
  /** ~p50 for a 500-token gemini-2.5-flash completion. */
  readonly estimatedLatencyMs = 600
  readonly costPerInputToken = 0
  readonly costPerOutputToken = 0

  private client: GoogleGenerativeAI | undefined
  private model: string

  constructor(private options: GeminiProviderOptions) {
    this.model = options.model ?? DEFAULT_MODEL
    // Defer SDK construction: the Google SDK may throw synchronously in its
    // constructor when apiKey is invalid, which would bypass BuddyLLMError
    // wrapping and escape the try/catch in generateCompletion. Lazy init
    // means an un-configured provider can still be constructed and rejected
    // cleanly via isAvailable().
  }

  async isAvailable(): Promise<boolean> {
    return typeof this.options.apiKey === 'string' && this.options.apiKey.length > 0
  }

  async generateCompletion(request: CompletionRequest): Promise<CompletionResult> {
    const start = Date.now()
    try {
      const genModel = this.getGenerativeModel()

      // Gemini's Content format separates a top-level systemInstruction from
      // the turn-based contents array. Assistant turns map to role: 'model'.
      const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = []
      for (const m of request.messages) {
        if (m.role === 'tool') continue // Phase 1 will handle tool-result round-trips
        if (m.role === 'system') {
          // Gemini has a dedicated systemInstruction field; if a caller puts a
          // system message in the messages array, hoist it by appending to
          // any systemPrompt they supplied.
          continue
        }
        // After the skips, m.role is narrowed to user | assistant, both of
        // which have `content: string` in the shared Message union.
        const role: 'user' | 'model' = m.role === 'assistant' ? 'model' : 'user'
        contents.push({ role, parts: [{ text: m.content }] })
      }

      const result = await genModel.generateContent({
        contents,
        systemInstruction: request.systemPrompt,
        generationConfig: {
          maxOutputTokens: request.maxTokens,
          temperature: request.temperature,
        },
      })

      const raw = result.response

      if (!raw.candidates || raw.candidates.length === 0) {
        throw new BuddyLLMError('Gemini returned no candidates')
      }

      const candidate = raw.candidates[0]

      // Preserve the distinction between "empty string" and "no text at all"
      // (e.g., a pure tool-call response or a safety-blocked candidate).
      // Gemini's .text() throws when a candidate has no text parts, so we
      // must guard it to avoid escaping the happy path.
      let text: string | undefined
      try {
        text = raw.text()
      } catch {
        text = undefined
      }

      return {
        content: text && text.length > 0 ? text : undefined,
        finishReason: this.mapFinishReason(candidate?.finishReason),
        inputTokens: raw.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: raw.usageMetadata?.candidatesTokenCount ?? 0,
        providerName: this.name,
        latencyMs: Date.now() - start,
      }
    } catch (err) {
      // BuddyLLMError should not be double-wrapped — re-throw ones we threw above.
      if (err instanceof BuddyLLMError) throw err
      // The @google/generative-ai SDK exposes HTTP status on
      // GoogleGenerativeAIFetchError.status. Extract it when present so the
      // router's telemetry row has something actionable.
      const status = err instanceof GoogleGenerativeAIFetchError ? err.status : undefined
      const suffix = status !== undefined ? ` (HTTP ${status})` : ''
      throw new BuddyLLMError(`Gemini request failed${suffix}`, err)
    }
  }

  private getClient(): GoogleGenerativeAI {
    if (!this.client) {
      if (!this.options.apiKey) {
        throw new BuddyLLMError('Gemini request failed: api key is missing')
      }
      this.client = new GoogleGenerativeAI(this.options.apiKey)
    }
    return this.client
  }

  private getGenerativeModel(): GenerativeModel {
    return this.getClient().getGenerativeModel({ model: this.model })
  }

  private mapFinishReason(raw: string | undefined): FinishReason {
    switch (raw) {
      case 'STOP':
        return 'stop'
      case 'MAX_TOKENS':
        return 'length'
      case 'SAFETY':
        return 'safety'
      default:
        return 'stop'
    }
  }
}
