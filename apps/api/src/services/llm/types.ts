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
  | 'coaching_utterance'
  | 'social_nudge'
  | 'onboarding_conversation'

export interface BuddyRequest {
  context: RequestContext
  userId: string
  systemPrompt?: string
  messages: readonly Message[]
  tools?: ToolDefinition[]
  preferredTier?: 1 | 2 | 3
  userOptedInPremium?: boolean
  maxTokens?: number
  temperature?: number
}

export class BuddyLLMError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'BuddyLLMError'
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
  // The weekly coaching utterance (slice 3 §5). One call per learner per week
  // behind the §6 cache, and it is the moment a learner is told something true
  // about their own progress — the output where quality matters most.
  'coaching_utterance',
]

export function classifyTier(request: BuddyRequest): 1 | 2 | 3 {
  if (request.preferredTier) return request.preferredTier
  if (TIER1_CONTEXTS.includes(request.context)) return 1
  if (TIER3_CONTEXTS.includes(request.context)) return 3
  return 2
}
