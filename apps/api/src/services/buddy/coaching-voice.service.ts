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
import { analysisBody, templateCopy, type Finding, type FinishReason } from '@kanji-learn/shared'
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

/**
 * Bound on the router call so a stalled tier-2 provider can never hold the
 * weekly session open (slice 3 review, Finding 2). 10s is generous for a
 * 400-token completion (MAX_TOKENS above) on the tier-2 providers this
 * context normally reaches, and it leaves headroom inside
 * apps/mobile/src/lib/api.ts's REQUEST_TIMEOUT_MS (30s, with one automatic
 * retry on a GET): the server must answer with the template well before the
 * client gives up, or a stalled call becomes a second forced
 * coaching.refresh, a second LLM call, and a second rate-limit slot spent on
 * the same session.
 */
export const COACHING_LLM_TIMEOUT_MS = 10_000

/** Distinguishes a bounded wait timing out from every other router failure
 *  (BuddyLLMError, a provider throwing directly), so the two can be logged
 *  distinctly. Never escapes this module. */
class CoachingTimeoutError extends Error {}

/**
 * Race `promise` against a timer. No provider in
 * apps/api/src/services/llm/providers/ accepts an AbortSignal, so the loser
 * of the race is not cancelled, only abandoned — the caller is responsible
 * for swallowing its eventual settlement. The timer is always cleared,
 * whichever side wins, so a fast response doesn't leave a dangling handle.
 */
function raceAgainstTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CoachingTimeoutError(`coaching LLM call exceeded ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export class CoachingVoiceService {
  constructor(
    private readonly db: Db,
    private readonly llm: Pick<BuddyLLMRouter, 'route'>,
    /** Overridable only for tests (a short injected bound beats faking
     *  timers against a real Postgres connection). Production callers should
     *  never pass this — it defaults to COACHING_LLM_TIMEOUT_MS. */
    private readonly llmTimeoutMs: number = COACHING_LLM_TIMEOUT_MS,
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
    let finishReason: FinishReason
    // Kicked off outside the try so the catch block below can still reach
    // this promise when the TIMEOUT wins the race, not the route call.
    const routePromise = this.llm.route({
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
    try {
      const result = await raceAgainstTimeout(routePromise, this.llmTimeoutMs)
      content = (result.content ?? '').trim()
      providerName = result.providerName
      finishReason = result.finishReason
    } catch (err) {
      if (err instanceof CoachingTimeoutError) {
        // The in-flight call is abandoned, not cancelled — no provider in
        // ../llm/providers/ accepts an AbortSignal, so there is nothing to
        // cancel it WITH. Attach a no-op catch so its eventual settlement
        // (almost always a late rejection once the caller's connection or
        // read times out upstream) never surfaces as an unhandled promise
        // rejection. We deliberately do not try to salvage a late SUCCESS
        // into the cache either: racing a write against this request's
        // already-returned response (or a second request's own attempt) is
        // a concurrency story worth avoiding for a case the next weekly
        // open resolves for free by simply trying again.
        routePromise.catch(() => {})
        input.log?.error({ userId: input.userId }, '[CoachingVoice] router timed out; using template')
      } else {
        // BuddyLLMError (tier-2 cap, both tier-2 providers down) and anything
        // else land in the same place, by design (§9).
        input.log?.error({ err, userId: input.userId }, '[CoachingVoice] router failed; using template')
      }
      return { text: template, source: 'template' }
    }

    // finishReason is an ALLOWLIST, not a blocklist: only 'stop' passes. This
    // is the safer shape for a field with four possible values, only one of
    // which ('stop') means "the model said everything it meant to say" — a
    // FinishReason this code has never seen before defaults to REJECTED, not
    // silently accepted. 'length' means the model was cut off mid-sentence by
    // the token limit (MAX_TOKENS), which happens well under
    // MAX_UTTERANCE_CHARS, so the character bound below does not catch it.
    // 'safety' means a provider's content filter fired; Claude never returns
    // it and Gemini's safety-blocked candidates carry no text (caught by the
    // empty check below regardless of this clause), but Groq's
    // content_filter can arrive WITH partial text, and a partially
    // generated, safety-stopped completion is exactly the kind of thing that
    // must not be cached for the rest of the learner's session period.
    // 'tool_use' is unreachable here (no tools are sent), so excluding it via
    // the allowlist costs nothing.
    if (content === '' || content.length > MAX_UTTERANCE_CHARS || finishReason !== 'stop') {
      // A discriminating tag, not just the raw finishReason: this slice
      // exists partly to produce a cost/quality read a fortnight after
      // rollout, and 'truncated' is the one cause with a tuning lever
      // (MAX_TOKENS) behind it — indistinguishable from the others in a log
      // line that only ever carried `length`.
      const reason: 'empty' | 'too_long' | 'truncated' | 'unsafe' =
        content === '' ? 'empty'
        : content.length > MAX_UTTERANCE_CHARS ? 'too_long'
        : finishReason === 'length' ? 'truncated'
        : 'unsafe'
      input.log?.error(
        { userId: input.userId, length: content.length, finishReason, reason },
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
    //
    // onConflictDoNothing(): two simultaneous first-opens can both miss the
    // cache read above and both reach this insert; the loser collides with
    // the (user_id, week_start) unique index. That collision is an expected
    // race, not a failure — the correct outcome is "the winner's utterance
    // stands" — so it must not raise into the catch below and be logged at
    // error level as a cache write failure indistinguishable from a genuine
    // one. The try/catch stays for genuine write failures (e.g. the FK to
    // user_profiles, exercised by coaching-voice.test.ts's "returns the
    // utterance even when the cache write fails").
    try {
      await this.db.insert(buddySessionUtterances).values({
        userId: input.userId,
        weekStart: input.weekStart,
        text,
        providerName,
      }).onConflictDoNothing()
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
