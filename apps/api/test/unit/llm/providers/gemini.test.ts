import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GeminiProvider } from '../../../../src/services/llm/providers/gemini'

// Mock the @google/generative-ai module.
// Notes:
// - The default export must be a function expression (not an arrow) because
//   the implementation calls `new GoogleGenerativeAI(...)` and vitest 4 uses
//   Reflect.construct on the mock — arrow functions aren't constructors.
// - GoogleGenerativeAIFetchError is a real class in @google/generative-ai; the
//   provider uses `instanceof GoogleGenerativeAIFetchError` to extract `.status`
//   for error enrichment, so the mock must export a constructable version that
//   the test can instantiate.
vi.mock('@google/generative-ai', () => {
  const generateContentMock = vi.fn()
  const getGenerativeModelMock = vi.fn().mockImplementation(() => ({
    generateContent: generateContentMock,
  }))
  class GoogleGenerativeAIFetchError extends Error {
    status?: number
    statusText?: string
    constructor(message: string, status?: number, statusText?: string) {
      super(message)
      this.name = 'GoogleGenerativeAIFetchError'
      this.status = status
      this.statusText = statusText
    }
  }
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(function () {
      return { getGenerativeModel: getGenerativeModelMock }
    }),
    GoogleGenerativeAIFetchError,
    __generateContentMock: generateContentMock,
    __getGenerativeModelMock: getGenerativeModelMock,
  }
})

import * as geminiModule from '@google/generative-ai'
import { GoogleGenerativeAIFetchError } from '@google/generative-ai'
const generateContentMock = (
  geminiModule as unknown as { __generateContentMock: ReturnType<typeof vi.fn> }
).__generateContentMock

describe('GeminiProvider', () => {
  beforeEach(() => {
    generateContentMock.mockReset()
  })

  it('exposes the expected metadata', () => {
    const provider = new GeminiProvider({ apiKey: 'test' })
    expect(provider.name).toBe('gemini')
    expect(provider.maxContextTokens).toBe(1_048_576)
    expect(provider.supportsToolCalling).toBe(true)
    expect(provider.costPerInputToken).toBe(0)
    expect(provider.costPerOutputToken).toBe(0)
  })

  it('generateCompletion calls the SDK and maps the response', async () => {
    generateContentMock.mockResolvedValue({
      response: {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'hello world' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5 },
        text: () => 'hello world',
      },
    })

    const provider = new GeminiProvider({ apiKey: 'test' })
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
    expect(result.providerName).toBe('gemini')
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)

    expect(generateContentMock).toHaveBeenCalledTimes(1)
    const call = generateContentMock.mock.calls[0][0]
    expect(call.contents).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
    ])
    expect(call.systemInstruction).toBe('You are a test')
    expect(call.generationConfig.maxOutputTokens).toBe(100)
    expect(call.generationConfig.temperature).toBe(0.5)
  })

  it('isAvailable returns true when an api key is present', async () => {
    const provider = new GeminiProvider({ apiKey: 'test' })
    expect(await provider.isAvailable()).toBe(true)
  })

  it('isAvailable returns false when api key is empty', async () => {
    const provider = new GeminiProvider({ apiKey: '' })
    expect(await provider.isAvailable()).toBe(false)
  })

  it('wraps SDK errors in BuddyLLMError', async () => {
    generateContentMock.mockRejectedValue(new Error('boom'))
    const provider = new GeminiProvider({ apiKey: 'test' })
    await expect(
      provider.generateCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 10,
        temperature: 0,
      })
    ).rejects.toThrow('Gemini request failed')
  })

  it('includes HTTP status in the error message when the SDK throws a GoogleGenerativeAIFetchError', async () => {
    // Cast via unknown because the mocked class isn't identical to the real
    // @google/generative-ai class signature.
    generateContentMock.mockRejectedValue(
      new (GoogleGenerativeAIFetchError as unknown as new (
        message: string,
        status?: number,
        statusText?: string
      ) => Error)('rate limit', 429, 'Too Many Requests')
    )
    const provider = new GeminiProvider({ apiKey: 'test' })
    await expect(
      provider.generateCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 10,
        temperature: 0,
      })
    ).rejects.toThrow('Gemini request failed (HTTP 429)')
  })

  it('throws BuddyLLMError when the response has no candidates', async () => {
    generateContentMock.mockResolvedValue({
      response: {
        candidates: [],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 0 },
        text: () => '',
      },
    })
    const provider = new GeminiProvider({ apiKey: 'test' })
    await expect(
      provider.generateCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 10,
        temperature: 0,
      })
    ).rejects.toThrow('Gemini returned no candidates')
  })

  it('returns undefined content (not empty string) when .text() throws', async () => {
    // Gemini's .text() throws when a candidate has no text parts — e.g. a
    // pure tool call or safety-blocked candidate. Preserve the semantic
    // distinction between "empty string" and "no text at all".
    generateContentMock.mockResolvedValue({
      response: {
        candidates: [
          {
            content: { role: 'model', parts: [] },
            finishReason: 'SAFETY',
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0 },
        text: () => {
          throw new Error('no text parts')
        },
      },
    })
    const provider = new GeminiProvider({ apiKey: 'test' })
    const result = await provider.generateCompletion({
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 10,
      temperature: 0,
    })
    expect(result.content).toBeUndefined()
    expect(result.finishReason).toBe('safety')
  })

  it('does not throw at construction when apiKey is empty; fails cleanly at call time', async () => {
    // Regression guard: the Google SDK may throw synchronously on an invalid
    // apiKey, which would bypass the generateCompletion try/catch. Lazy init
    // means construction is always safe.
    const provider = new GeminiProvider({ apiKey: '' })
    await expect(
      provider.generateCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 10,
        temperature: 0,
      })
    ).rejects.toThrow('api key is missing')
  })
})
