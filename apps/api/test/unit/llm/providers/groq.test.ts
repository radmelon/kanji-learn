import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GroqProvider } from '../../../../src/services/llm/providers/groq'

// Mock the groq-sdk module.
// Notes:
// - The default export must be a function expression (not an arrow) because
//   the implementation calls `new Groq(...)` and vitest 4 uses
//   Reflect.construct on the mock — arrow functions aren't constructors.
// - APIError is a real class in groq-sdk; the provider uses `instanceof APIError`
//   to extract `.status` for error enrichment, so the mock must export a
//   constructable APIError that the test can instantiate.
vi.mock('groq-sdk', () => {
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
      return { chat: { completions: { create: createMock } } }
    }),
    APIError,
    __createMock: createMock,
  }
})

import * as groqModule from 'groq-sdk'
import { APIError } from 'groq-sdk'
const createMock = (groqModule as unknown as { __createMock: ReturnType<typeof vi.fn> }).__createMock

describe('GroqProvider', () => {
  beforeEach(() => {
    createMock.mockReset()
  })

  it('exposes the expected metadata', () => {
    const provider = new GroqProvider({ apiKey: 'test' })
    expect(provider.name).toBe('groq')
    expect(provider.maxContextTokens).toBe(128_000)
    expect(provider.supportsToolCalling).toBe(true)
    expect(provider.costPerInputToken).toBe(0)
    expect(provider.costPerOutputToken).toBe(0)
  })

  it('generateCompletion calls the SDK and maps the response', async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: { role: 'assistant', content: 'hello world' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 5 },
    })

    const provider = new GroqProvider({ apiKey: 'test' })
    const result = await provider.generateCompletion({
      systemPrompt: 'You are a test',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
      temperature: 0.5,
    })

    expect(result.content).toBe('hello world')
    expect(result.inputTokens).toBe(12)
    expect(result.outputTokens).toBe(5)
    expect(result.finishReason).toBe('stop')
    expect(result.providerName).toBe('groq')
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)

    expect(createMock).toHaveBeenCalledTimes(1)
    const call = createMock.mock.calls[0][0]
    expect(call.model).toBe('llama-3.3-70b-versatile')
    expect(call.messages[0]).toEqual({ role: 'system', content: 'You are a test' })
    expect(call.messages[1]).toEqual({ role: 'user', content: 'hi' })
    expect(call.max_tokens).toBe(100)
    expect(call.temperature).toBe(0.5)
  })

  it('isAvailable returns true when an api key is present', async () => {
    const provider = new GroqProvider({ apiKey: 'test' })
    expect(await provider.isAvailable()).toBe(true)
  })

  it('isAvailable returns false when api key is empty', async () => {
    const provider = new GroqProvider({ apiKey: '' })
    expect(await provider.isAvailable()).toBe(false)
  })

  it('wraps SDK errors in BuddyLLMError', async () => {
    createMock.mockRejectedValue(new Error('429 rate limit'))
    const provider = new GroqProvider({ apiKey: 'test' })
    await expect(
      provider.generateCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 10,
        temperature: 0,
      })
    ).rejects.toThrow('Groq request failed')
  })

  it('includes HTTP status in the error message when the SDK throws an APIError', async () => {
    // Cast via unknown because the mocked APIError class isn't identical to
    // the real groq-sdk APIError signature.
    createMock.mockRejectedValue(new (APIError as unknown as new (
      status: number,
      message: string
    ) => Error)(429, 'rate limit'))
    const provider = new GroqProvider({ apiKey: 'test' })
    await expect(
      provider.generateCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 10,
        temperature: 0,
      })
    ).rejects.toThrow('Groq request failed (HTTP 429)')
  })

  it('throws BuddyLLMError when the response has no choices', async () => {
    createMock.mockResolvedValue({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 0 } })
    const provider = new GroqProvider({ apiKey: 'test' })
    await expect(
      provider.generateCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 10,
        temperature: 0,
      })
    ).rejects.toThrow('Groq returned no choices')
  })

  it('returns undefined content (not empty string) when the model emits null content', async () => {
    // Preserves the semantic distinction for pure tool-call responses.
    createMock.mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: null }, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 10, completion_tokens: 0 },
    })
    const provider = new GroqProvider({ apiKey: 'test' })
    const result = await provider.generateCompletion({
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 10,
      temperature: 0,
    })
    expect(result.content).toBeUndefined()
    expect(result.finishReason).toBe('tool_use')
  })

  it('does not throw at construction when apiKey is empty; fails cleanly at call time', async () => {
    // Regression guard: the Groq SDK throws synchronously on undefined apiKey,
    // which would bypass the generateCompletion try/catch. Lazy init means
    // construction is always safe.
    const provider = new GroqProvider({ apiKey: '' })
    await expect(
      provider.generateCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 10,
        temperature: 0,
      })
    ).rejects.toThrow('api key is missing')
  })
})
