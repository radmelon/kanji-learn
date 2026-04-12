import type { CompletionRequest, CompletionResult, LLMProvider } from '@kanji-learn/shared'
import { BuddyLLMError } from '../types'

/**
 * Server-side placeholder for Apple Foundation Models.
 *
 * The real provider lives in the mobile app (Phase 2) and runs on-device.
 * This stub exists so the router's constructor has a uniformly-typed slot
 * for the on-device provider. It always reports unavailable and throws if
 * asked to generate, which causes the router to fall through to Tier 2.
 */
export class AppleFoundationStubProvider implements LLMProvider {
  readonly name = 'apple-foundation-stub'
  readonly supportsToolCalling = false
  readonly maxContextTokens = 4096
  readonly estimatedLatencyMs = 200
  readonly costPerInputToken = 0
  readonly costPerOutputToken = 0

  async isAvailable(): Promise<boolean> {
    return false
  }

  async generateCompletion(_request: CompletionRequest): Promise<CompletionResult> {
    throw new BuddyLLMError('AppleFoundationStubProvider cannot generate on the server')
  }
}
