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
  content: string
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
  readonly estimatedLatencyMs: number
  readonly costPerInputToken: number
  readonly costPerOutputToken: number

  generateCompletion(request: CompletionRequest): Promise<CompletionResult>
  isAvailable(): Promise<boolean>
}
