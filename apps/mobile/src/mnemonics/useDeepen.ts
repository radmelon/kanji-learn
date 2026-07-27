import { useCallback, useState } from 'react'
import type { AssemblerSlots, CoCreationContext } from '@kanji-learn/shared'
import { assembleStory } from './assembleStory'
import { deepenHook } from './cocreationApi'
import { buildDeepenedContext, type ThreadSource } from './buildDeepenedContext'

export * from './buildDeepenedContext'

/** Dependency seams so the hook's async effects are mockable. */
export interface DeepenDeps {
  assemble: typeof assembleStory
  deepen: typeof deepenHook
  nowIso: () => string
}
const defaultDeps: DeepenDeps = {
  assemble: assembleStory,
  deepen: deepenHook,
  nowIso: () => new Date().toISOString(),
}

/**
 * "Go deeper" on an existing hook — one entry point, two kinds of thread
 * (parent spec §6.3, design spec §6.2).
 *
 * Reached either from the reinforce sheet when the deepen gate trips, or
 * proactively from kanji detail. Nothing is ever discarded: the assembled
 * story replaces the displayed text, but every previous layer stays in
 * `cocreation_context.layers`, so the hook only accumulates.
 */
export function useDeepen(
  mnemonicId: string,
  context: CoCreationContext,
  slots: AssemblerSlots,
  deps: DeepenDeps = defaultDeps,
) {
  const [thread, setThread] = useState<ThreadSource | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState(false)

  const chooseThread = useCallback((t: ThreadSource) => {
    setThread(t)
    setError(false)
  }, [])

  const submitAnswer = useCallback(
    async (answer: string) => {
      const trimmed = answer.trim()
      if (!thread || !trimmed || isSubmitting) return
      setIsSubmitting(true)
      setError(false)
      try {
        // Feed the new answer through the same cloud → on-device → template
        // cascade the create flow uses. The template tier always succeeds, so
        // a failure here means the network call itself died, not assembly.
        const assembled = await deps.assemble({ ...slots, anchor: trimmed })
        const nextContext = buildDeepenedContext(
          context,
          thread,
          trimmed,
          assembled.generatedBy,
          deps.nowIso(),
        )
        await deps.deepen(mnemonicId, {
          storyText: assembled.storyText,
          context: nextContext,
        })
        return true
      } catch {
        // Surface it rather than closing — the learner just did the hard part
        // (recalling something) and losing that to a dropped request is worse
        // than asking them to tap again.
        setError(true)
        return false
      } finally {
        setIsSubmitting(false)
      }
    },
    [thread, isSubmitting, deps, context, slots, mnemonicId],
  )

  return { thread, chooseThread, submitAnswer, isSubmitting, error }
}
