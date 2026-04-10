import { describe, it, expect } from 'vitest'
import { AppleFoundationStubProvider } from '../../../../src/services/llm/providers/apple-foundation-stub'
import { BuddyLLMError } from '../../../../src/services/llm/types'

describe('AppleFoundationStubProvider', () => {
  it('isAvailable returns false', async () => {
    const provider = new AppleFoundationStubProvider()
    expect(await provider.isAvailable()).toBe(false)
  })

  it('generateCompletion throws BuddyLLMError with a meaningful message', async () => {
    const provider = new AppleFoundationStubProvider()
    await expect(
      provider.generateCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 10,
        temperature: 0,
      })
    ).rejects.toThrow(BuddyLLMError)
    await expect(
      provider.generateCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 10,
        temperature: 0,
      })
    ).rejects.toThrow('AppleFoundationStubProvider cannot generate on the server')
  })
})
