import { describe, it, expect } from 'vitest'
import { BuddyLLMError, classifyTier } from '../../../src/services/llm/types'
import type { BuddyRequest } from '../../../src/services/llm/types'

describe('BuddyLLMError', () => {
  it('captures the wrapped cause', () => {
    const cause = new Error('boom')
    const err = new BuddyLLMError('All providers failed', cause)
    expect(err.message).toBe('All providers failed')
    expect(err.cause).toBe(cause)
    expect(err.name).toBe('BuddyLLMError')
  })
})

describe('classifyTier', () => {
  const base: BuddyRequest = {
    context: 'encouragement',
    userId: 'u1',
    systemPrompt: '',
    messages: [],
  }

  it('returns 1 for simple template-like contexts', () => {
    expect(classifyTier({ ...base, context: 'encouragement' })).toBe(1)
    expect(classifyTier({ ...base, context: 'streak_message' })).toBe(1)
    expect(classifyTier({ ...base, context: 'milestone_celebration' })).toBe(1)
    expect(classifyTier({ ...base, context: 'session_summary' })).toBe(1)
  })

  it('returns 3 for deep-reasoning contexts', () => {
    expect(classifyTier({ ...base, context: 'mnemonic_cocreation' })).toBe(3)
    expect(classifyTier({ ...base, context: 'deep_diagnostic' })).toBe(3)
  })

  it('returns 2 for everything else', () => {
    expect(classifyTier({ ...base, context: 'study_plan_generation' })).toBe(2)
    expect(classifyTier({ ...base, context: 'leech_diagnostic' })).toBe(2)
    expect(classifyTier({ ...base, context: 'mnemonic_question_generation' })).toBe(2)
    expect(classifyTier({ ...base, context: 'mnemonic_assembly' })).toBe(2)
    expect(classifyTier({ ...base, context: 'social_nudge' })).toBe(2)
  })
})
