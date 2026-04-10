import type { Message, ToolDefinition } from '@kanji-learn/shared'

export type RequestContext =
  | 'encouragement'
  | 'streak_message'
  | 'milestone_celebration'
  | 'session_summary'
  | 'study_plan_generation'
  | 'leech_diagnostic'
  | 'mnemonic_question_generation'
  | 'mnemonic_assembly'
  | 'mnemonic_cocreation'
  | 'deep_diagnostic'
  | 'social_nudge'

export interface BuddyRequest {
  context: RequestContext
  userId: string
  systemPrompt: string
  messages: Message[]
  tools?: ToolDefinition[]
  preferredTier?: 1 | 2 | 3
  userOptedInPremium?: boolean
  maxTokens?: number
  temperature?: number
}

export class BuddyLLMError extends Error {
  public readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'BuddyLLMError'
    this.cause = cause
  }
}

const TIER1_CONTEXTS: readonly RequestContext[] = [
  'encouragement',
  'streak_message',
  'milestone_celebration',
  'session_summary',
]

const TIER3_CONTEXTS: readonly RequestContext[] = [
  'mnemonic_cocreation',
  'deep_diagnostic',
]

export function classifyTier(request: BuddyRequest): 1 | 2 | 3 {
  if (request.preferredTier) return request.preferredTier
  if (TIER1_CONTEXTS.includes(request.context)) return 1
  if (TIER3_CONTEXTS.includes(request.context)) return 3
  return 2
}
