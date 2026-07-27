import type { AssemblyTier, CoCreationContext } from '@kanji-learn/shared'

/**
 * Which kind of thread the learner is adding to an existing hook.
 *
 * `cocreation_context.layers[].source` was typed for both of these from the
 * start (parent spec §10.1) but only `environment` ever had a way in — the
 * "stickier" questions inside the create flow. Deepen opens the other door.
 */
export type ThreadSource = 'environment' | 'known_knowledge'

/**
 * The question each thread asks.
 *
 * Copy discipline (parent spec §6.3): never "rebuild", "start over",
 * "replace" or "discard". A hook is only ever added to.
 */
export const THREAD_PROMPTS: Record<ThreadSource, string> = {
  environment:
    'Add a detail — what are you wearing, or what does the reading sound like?',
  known_knowledge:
    'What does this remind you of that you already know cold? Another kanji, a word, a memory.',
}

/**
 * Append a layer to an existing hook's context.
 *
 * Deliberately pure and total: given the same inputs it returns the same
 * context, mutates nothing, and performs no I/O. The hook that calls it owns
 * the network. Mirrors `buildContext` in buildSlots.ts.
 *
 * Two things here exist because an adversarial review of the plan caught them:
 *  - `generatedBy` records the tier that produced THIS layer, not the tier
 *    that produced the original story.
 *  - `mnemonicQuizDueAt` is re-stamped. Parent spec §8 stamps on create *or*
 *    deepen; without this a deepened hook would never earn a fresh
 *    quick-check, and any stale stamp would ride along unchanged.
 */
export function buildDeepenedContext(
  context: CoCreationContext,
  thread: ThreadSource,
  answer: string,
  generatedBy: AssemblyTier,
  nowIso: string,
): CoCreationContext {
  return {
    ...context,
    layers: [
      ...context.layers,
      { questions: [THREAD_PROMPTS[thread]], answers: [answer], source: thread },
    ],
    layerCount: context.layerCount + 1,
    generatedBy,
    mnemonicQuizDueAt: nowIso,
  }
}
