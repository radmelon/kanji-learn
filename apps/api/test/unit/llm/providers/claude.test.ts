import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ClaudeProvider } from '../../../../src/services/llm/providers/claude'

// Mock the @anthropic-ai/sdk module.
// Notes:
// - The default export must be a function expression (not an arrow) because
//   the implementation calls `new Anthropic(...)` and vitest 4 uses
//   Reflect.construct on the mock — arrow functions aren't constructors.
// - APIError is a real class in @anthropic-ai/sdk; the provider uses
//   `instanceof APIError` to extract `.status` for error enrichment, so the
//   mock must export a constructable APIError that the test can instantiate.
vi.mock('@anthropic-ai/sdk', () => {
  const createMock = vi.fn()
  class APIError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.name = 'APIError'
      this.status = status
    }
  }
  return {
    default: vi.fn().mockImplementation(function () {
      return { messages: { create: createMock } }
    }),
    APIError,
    __createMock: createMock,
  }
})

import * as anthropicModule from '@anthropic-ai/sdk'
import { APIError } from '@anthropic-ai/sdk'
const createMock = (
  anthropicModule as unknown as { __createMock: ReturnType<typeof vi.fn> }
).__createMock

describe('ClaudeProvider', () => {
  beforeEach(() => {
    createMock.mockReset()
  })

  it('exposes the expected metadata', () => {
    const provider = new ClaudeProvider({ apiKey: 'test' })
    expect(provider.name).toBe('claude')
    expect(provider.maxContextTokens).toBe(200_000)
    expect(provider.supportsToolCalling).toBe(true)
    expect(provider.estimatedLatencyMs).toBe(1_200)
    expect(provider.costPerInputToken).toBe(0.000003)
    expect(provider.costPerOutputToken).toBe(0.000015)
  })

  it('generateCompletion calls the SDK and maps the response', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'claude says hi' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 9, output_tokens: 6 },
    })

    const provider = new ClaudeProvider({ apiKey: 'test' })
    const result = await provider.generateCompletion({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
      temperature: 0.4,
    })

    expect(result.content).toBe('claude says hi')
    expect(result.inputTokens).toBe(9)
    expect(result.outputTokens).toBe(6)
    expect(result.finishReason).toBe('stop')
    expect(result.providerName).toBe('claude')
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)

    expect(createMock).toHaveBeenCalledTimes(1)
    const call = createMock.mock.calls[0][0]
    expect(call.model).toBe('claude-sonnet-4-6')
    expect(call.system).toBe('sys')
    expect(call.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(call.max_tokens).toBe(100)
    expect(call.temperature).toBe(0.4)
  })

  it('isAvailable returns true when an api key is present', async () => {
    const provider = new ClaudeProvider({ apiKey: 'test' })
    expect(await provider.isAvailable()).toBe(true)
  })

  it('isAvailable returns false when api key is empty', async () => {
    const provider = new ClaudeProvider({ apiKey: '' })
    expect(await provider.isAvailable()).toBe(false)
  })

  it('wraps SDK errors in BuddyLLMError', async () => {
    createMock.mockRejectedValue(new Error('anthropic boom'))
    const provider = new ClaudeProvider({ apiKey: 'test' })
    await expect(
      provider.generateCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 10,
        temperature: 0,
      })
    ).rejects.toThrow('Claude request failed')
  })

  it('includes HTTP status in the error message when the SDK throws an APIError', async () => {
    // Cast via unknown because the mocked APIError class isn't identical to
    // the real @anthropic-ai/sdk APIError signature.
    createMock.mockRejectedValue(
      new (APIError as unknown as new (status: number, message: string) => Error)(
        429,
        'rate limit'
      )
    )
    const provider = new ClaudeProvider({ apiKey: 'test' })
    await expect(
      provider.generateCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 10,
        temperature: 0,
      })
    ).rejects.toThrow('Claude request failed (HTTP 429)')
  })

  it('throws BuddyLLMError when the response has an empty content blocks array', async () => {
    createMock.mockResolvedValue({
      content: [],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 0 },
    })
    const provider = new ClaudeProvider({ apiKey: 'test' })
    await expect(
      provider.generateCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 10,
        temperature: 0,
      })
    ).rejects.toThrow('Claude returned no content blocks')
  })

  it('returns undefined content (not empty string) when no text block exists', async () => {
    // Pure tool_use response — preserve the semantic distinction between
    // "empty string" and "no text at all".
    createMock.mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'lookup_kanji',
          input: { kanji: '水' },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 20, output_tokens: 5 },
    })
    const provider = new ClaudeProvider({ apiKey: 'test' })
    const result = await provider.generateCompletion({
      messages: [{ role: 'user', content: 'look up 水' }],
      maxTokens: 50,
      temperature: 0,
    })
    expect(result.content).toBeUndefined()
    expect(result.finishReason).toBe('tool_use')
    expect(result.toolCalls).toBeUndefined() // Phase 0 doesn't populate
  })

  it('detects a tool_use content block and overrides finishReason even when stop_reason says end_turn', async () => {
    // Defensive: if a future SDK version or edge case lets stop_reason
    // diverge from the content block types, we still surface tool_use so
    // the router doesn't mistake a tool call for a normal stop.
    createMock.mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          id: 'toolu_2',
          name: 'lookup_kanji',
          input: { kanji: '火' },
        },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 15, output_tokens: 4 },
    })
    const provider = new ClaudeProvider({ apiKey: 'test' })
    const result = await provider.generateCompletion({
      messages: [{ role: 'user', content: 'look up 火' }],
      maxTokens: 50,
      temperature: 0,
    })
    expect(result.finishReason).toBe('tool_use')
    expect(result.content).toBeUndefined()
  })

  it('does not throw at construction when apiKey is empty; fails cleanly at call time', async () => {
    // Regression guard: the Anthropic SDK may throw synchronously on missing
    // apiKey, which would bypass the generateCompletion try/catch. Lazy init
    // means construction is always safe.
    const provider = new ClaudeProvider({ apiKey: '' })
    await expect(
      provider.generateCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 10,
        temperature: 0,
      })
    ).rejects.toThrow('api key is missing')
  })
})
