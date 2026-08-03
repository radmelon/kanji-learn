// apps/api/src/services/buddy/coaching-voice.service.ts
//
// Analysis mode's one moving part (slice 3 §§6, 9). Cache read → prompt →
// route → validate → cache write, with the template as the floor under every
// failure.
//
// THE PROPERTY WORTH PROTECTING: this can never regress the weekly session,
// because its worst case is exactly the session as it ships today with slice
// 2's findings appended. An LLM outage degrades the conversation and never the
// record — the notebook entry is written by CoachingService and is not touched
// here (§2).
//
// It never throws. The caller's job is to render a session; a coaching failure
// is not a reason to fail that.

import { and, eq } from 'drizzle-orm'
import { buddySessionUtterances } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import { analysisBody, templateCopy, type Finding } from '@kanji-learn/shared'
import type { BuddyLLMRouter } from '../llm/router'
import { buildCoachingPrompt, partitionForVoice } from './coaching-prompt'

export interface CoachingVoice {
  text: string
  /** Part of the response, not logs only (§8): it makes the fallback
   *  observable from the client, and it is what an integration test asserts to
   *  prove the template path ran without asserting any prose. */
  source: 'llm' | 'template'
}

/**
 * Sanity bound on model output (§9). Four or five sentences is ~400 chars; this
 * is generous headroom that still stops a runaway completion becoming the whole
 * session screen.
 */
export const MAX_UTTERANCE_CHARS = 1500

/** Enough for four or five sentences, not enough for an essay. */
const MAX_TOKENS = 400

/**
 * Lower than meeting-prompt's 0.7. The learner is being told true things about
 * their own progress, and the failure mode that matters is an invented number,
 * not a flat sentence.
 */
const TEMPERATURE = 0.4

export class CoachingVoiceService {
  constructor(
    private readonly db: Db,
    private readonly llm: Pick<BuddyLLMRouter, 'route'>,
  ) {}

  async utteranceFor(input: {
    userId: string
    weekStart: string
    openerKind: string
    openerText: string
    reckon: string | null
    findings: readonly Finding[]
    now: string
    log?: { error: (obj: object, msg: string) => void }
  }): Promise<CoachingVoice | null> {
    // §2's common case, stated explicitly because it is the COMMON one: most
    // weeks have no materially new finding. No call, no voice field, and the
    // client renders opener + reckon exactly as it does today.
    if (input.findings.length === 0) return null

    let cached: string | null
    try {
      cached = await this.readCache(input.userId, input.weekStart)
    } catch (err) {
      // A failed cache read degrades to a MISS, never an error: a lost read
      // costs at most one extra LLM call for this session, while letting it
      // throw costs the learner their coaching entirely. This mirrors how the
      // cache WRITE failure below is handled — the cache is an optimisation,
      // and neither direction of a cache failure may take down the surface it
      // optimises.
      input.log?.error({ err, userId: input.userId }, '[CoachingVoice] cache read failed; treating as miss')
      cached = null
    }
    // A cache hit always implies 'llm' — fallbacks are deliberately not cached,
    // so a transient outage cannot freeze a degraded session for the period.
    if (cached !== null) return { text: cached, source: 'llm' }

    const { spoken, mechanics } = partitionForVoice(input.findings)
    const template = this.templateText(input)

    // Nothing the LLM is permitted to voice. Routing would spend a call on an
    // empty finding list.
    if (spoken.length === 0) return { text: template, source: 'template' }

    let content: string
    let providerName: string
    try {
      const result = await this.llm.route({
        context: 'coaching_utterance',
        userId: input.userId,
        // userOptedInPremium is deliberately UNSET. tutor-analysis.service.ts
        // forces it true to bypass the premium gate; §5 wants the opposite
        // here — opted-in learners get Claude, everyone else falls through to
        // tier 2 with no branching at this call site.
        messages: [{ role: 'user', content: buildCoachingPrompt({
          openerKind: input.openerKind,
          openerText: input.openerText,
          reckon: input.reckon,
          findings: spoken,
        }) }],
        maxTokens: MAX_TOKENS,
        temperature: TEMPERATURE,
      })
      content = (result.content ?? '').trim()
      providerName = result.providerName
    } catch (err) {
      // BuddyLLMError (tier-2 cap, both tier-2 providers down) and anything
      // else land in the same place, by design (§9).
      input.log?.error({ err, userId: input.userId }, '[CoachingVoice] router failed; using template')
      return { text: template, source: 'template' }
    }

    if (content === '' || content.length > MAX_UTTERANCE_CHARS) {
      input.log?.error(
        { userId: input.userId, length: content.length },
        '[CoachingVoice] unusable completion; using template',
      )
      return { text: template, source: 'template' }
    }

    // §4: the explainer is appended AFTER the composed utterance, never sent
    // to the model. The visible seam between warm prose and fixed copy is the
    // accepted cost — it IS a different kind of statement.
    const text = mechanics === null
      ? content
      : `${content}\n\n${templateCopy(mechanics, input.now)}`

    // Cache the COMPOSED text, so a hit returns byte-for-byte what the first
    // open returned.
    try {
      await this.db.insert(buddySessionUtterances).values({
        userId: input.userId,
        weekStart: input.weekStart,
        text,
        providerName,
      })
    } catch (err) {
      // §9: return the utterance anyway. A lost cache write costs one extra
      // call on the next open; failing the session costs the session.
      input.log?.error({ err, userId: input.userId }, '[CoachingVoice] cache write failed')
    }

    return { text, source: 'llm' }
  }

  /**
   * §9's floor: today's surface plus slice 2's prose.
   *
   * ⚠️ `now` is passed to analysisBody deliberately. copy.ts:62 reads
   * `if (!now || days >= ESCALATE_AFTER_DAYS)`, so dropping it escalates every
   * finding that carries a `since` regardless of age — silently, with nothing
   * else failing.
   */
  private templateText(input: {
    openerText: string
    reckon: string | null
    findings: readonly Finding[]
    now: string
  }): string {
    return [input.openerText, input.reckon, analysisBody(input.findings, input.now)]
      .filter((part): part is string => part !== null && part !== '')
      .join('\n\n')
  }

  private async readCache(userId: string, weekStart: string): Promise<string | null> {
    const rows = await this.db
      .select({ text: buddySessionUtterances.text })
      .from(buddySessionUtterances)
      .where(and(
        eq(buddySessionUtterances.userId, userId),
        eq(buddySessionUtterances.weekStart, weekStart),
      ))
      .limit(1)
    return rows[0]?.text ?? null
  }
}
