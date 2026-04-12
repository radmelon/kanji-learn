// packages/shared/src/llm-types.ts
// Provider-agnostic LLM types. Usable from server and client.

export type JSONSchema = Record<string, unknown>

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: JSONSchema
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

// Phase 0 never constructs a ToolResult — tool-result round-trips come
// in Phase 1. The type exists so the Message union is shape-complete,
// but provider adapters in Tasks 11–13 drop `role: 'tool'` messages.
export interface ToolResult {
  toolCallId: string
  content: string | Record<string, unknown>
  isError?: boolean
}

export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolResults: ToolResult[] }

export interface CompletionRequest {
  systemPrompt?: string
  messages: Message[]
  tools?: ToolDefinition[]
  maxTokens: number
  temperature: number
  responseFormat?: 'text' | 'json'
}

export type FinishReason = 'stop' | 'length' | 'tool_use' | 'safety'

export interface CompletionResult {
  /**
   * Assistant text. Optional because a pure tool-call response (finishReason
   * === 'tool_use') carries no text. Providers MAY emit `''` instead of
   * omitting the field; both are valid.
   */
  content?: string
  toolCalls?: ToolCall[]
  finishReason: FinishReason
  inputTokens: number
  outputTokens: number
  providerName: string
  latencyMs: number
}

export interface LLMProvider {
  readonly name: string
  readonly supportsToolCalling: boolean
  readonly maxContextTokens: number
  /** Expected p50 latency for a ~500-token completion, in milliseconds. */
  readonly estimatedLatencyMs: number
  /** Cost per input token in USD (e.g. 0.000003 for $3 / 1M tokens). */
  readonly costPerInputToken: number
  /** Cost per output token in USD (e.g. 0.000015 for $15 / 1M tokens). */
  readonly costPerOutputToken: number

  generateCompletion(request: CompletionRequest): Promise<CompletionResult>
  isAvailable(): Promise<boolean>
}
