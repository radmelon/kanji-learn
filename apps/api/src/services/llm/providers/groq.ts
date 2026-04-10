import Groq from 'groq-sdk'
import type {
  CompletionRequest,
  CompletionResult,
  FinishReason,
  LLMProvider,
  Message,
} from '@kanji-learn/shared'
import { BuddyLLMError } from '../types'

export interface GroqProviderOptions {
  apiKey: string
  model?: string
}

const DEFAULT_MODEL = 'llama-3.3-70b-versatile'

export class GroqProvider implements LLMProvider {
  readonly name = 'groq'
  readonly supportsToolCalling = true
  readonly maxContextTokens = 128_000
  readonly estimatedLatencyMs = 400
  readonly costPerInputToken = 0
  readonly costPerOutputToken = 0

  private client: Groq
  private model: string

  constructor(private options: GroqProviderOptions) {
    this.client = new Groq({ apiKey: options.apiKey })
    this.model = options.model ?? DEFAULT_MODEL
  }

  async isAvailable(): Promise<boolean> {
    return typeof this.options.apiKey === 'string' && this.options.apiKey.length > 0
  }

  async generateCompletion(request: CompletionRequest): Promise<CompletionResult> {
    const start = Date.now()
    try {
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
      if (request.systemPrompt) {
        messages.push({ role: 'system', content: request.systemPrompt })
      }
      for (const m of request.messages) {
        if (m.role === 'tool') continue // Groq tool-result messages handled in a later phase
        messages.push({ role: m.role, content: m.content as string })
      }

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
      })

      const choice = response.choices[0]
      return {
        content: (choice?.message?.content as string | null) ?? '',
        finishReason: this.mapFinishReason(choice?.finish_reason ?? null),
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        providerName: this.name,
        latencyMs: Date.now() - start,
      }
    } catch (err) {
      throw new BuddyLLMError('Groq request failed', err)
    }
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
