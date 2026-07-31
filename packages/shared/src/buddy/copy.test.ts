import { describe, it, expect } from 'vitest'
import { openerCopy, reckonCopy, stepDownCopy } from './copy'
import { checkPromise, type PromiseInput } from './reckoning'

const agreed: PromiseInput = { daysCommitted: 4, minutesPerDay: 15, source: 'session' }
const rolled: PromiseInput = { ...agreed, source: 'rolled_forward' }

function days(...minutes: number[]) {
  return minutes.map((m, i) => ({
    date: `2026-08-0${3 + i}`,
    reviewed: m > 0 ? 10 : 0,
    studyMinutes: m,
  }))
}

const four = checkPromise(agreed, days(20, 20, 20, 20))
const one = checkPromise(agreed, days(20))
const none = checkPromise(agreed, [])
const two = checkPromise(agreed, days(20, 20))

describe('openerCopy', () => {
  it('returns non-empty copy for every opener kind', () => {
    for (const kind of ['strong', 'steady', 'off', 'absent', 'first_ever'] as const) {
      expect(openerCopy(kind, none).trim().length).toBeGreaterThan(0)
    }
  })

  it('a strong week names the actual number of days — specific, not generic', () => {
    expect(openerCopy('strong', four)).toContain('4')
  })

  it('a strong week reports the real figure, not a hardcoded one', () => {
    const five = checkPromise({ ...agreed, daysCommitted: 5 }, days(20, 20, 20, 20, 20))
    expect(openerCopy('strong', five)).toContain('5')
  })

  it('an OFF week states NO number — it asks about the person', () => {
    // The tone rule that carries the whole feature: a poor week opens with
    // care, not data. Not softer wording around the same figures — no figures.
    const text = openerCopy('off', one)
    expect(text).not.toMatch(/\d/)
    expect(text).toContain('?')
  })

  it('an ABSENT week states no number either, and does not interrogate', () => {
    expect(openerCopy('absent', none)).not.toMatch(/\d/)
  })

  it('never inflates — no gushing adjectives anywhere', () => {
    for (const kind of ['strong', 'steady', 'off', 'absent', 'first_ever'] as const) {
      const text = openerCopy(kind, four).toLowerCase()
      for (const word of ['amazing', 'awesome', 'incredible', 'fantastic', 'crushing it']) {
        expect(text).not.toContain(word)
      }
    }
  })

  it('first_ever introduces Buddy by name and discloses that it gets to know you', () => {
    const text = openerCopy('first_ever', none).toLowerCase()
    expect(text).toContain('buddy')
    expect(text).toMatch(/know you|get to know|learn about you/)
  })

  it('every kind reads as a distinct message', () => {
    const all = (['strong', 'steady', 'off', 'absent', 'first_ever'] as const)
      .map((k) => openerCopy(k, two))
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('reckonCopy', () => {
  it('is silent for a commitment that was never agreed', () => {
    expect(reckonCopy(checkPromise(rolled, days(20)))).toBeNull()
  })

  it('is silent for a default seed too', () => {
    expect(reckonCopy(checkPromise({ ...agreed, source: 'default' }, days(20)))).toBeNull()
  })

  it('states both the promise and the outcome when a promise was missed', () => {
    const missed = checkPromise(agreed, days(20))
    const text = reckonCopy(missed)
    expect(text).not.toBeNull()
    expect(text!).toContain('4')
    expect(text!).toContain('1')
  })

  it('acknowledges a kept promise', () => {
    const text = reckonCopy(four)
    expect(text).not.toBeNull()
    expect(text!).toContain('4')
  })

  it('never scolds, in any verdict', () => {
    for (const check of [four, two, one, none]) {
      const text = (reckonCopy(check) ?? '').toLowerCase()
      for (const word of ['should have', 'failed', 'only managed', 'disappoint', 'excuse']) {
        expect(text).not.toContain(word)
      }
    }
  })
})

describe('stepDownCopy', () => {
  it('the two rungs say different things', () => {
    const toFortnightly = stepDownCopy({ buddyDay: 1, intervalWeeks: 2 })
    const toNothing = stepDownCopy({ buddyDay: null, intervalWeeks: 2 })
    expect(toFortnightly).not.toBe(toNothing)
    expect(toFortnightly.trim().length).toBeGreaterThan(0)
    expect(toNothing.trim().length).toBeGreaterThan(0)
  })

  it('stepping down to fortnightly still promises to return', () => {
    const text = stepDownCopy({ buddyDay: 1, intervalWeeks: 2 }).toLowerCase()
    expect(text).toMatch(/other week|fortnight|every two weeks|less often/)
  })

  it('stopping entirely tells the learner how to restart it', () => {
    // The step-down exists so the quiet exit is ours rather than iOS
    // notification settings. An exit with no way back is just churn.
    const text = stepDownCopy({ buddyDay: null, intervalWeeks: 2 }).toLowerCase()
    expect(text).toMatch(/shout|say the word|let me know|whenever you|come back|ask me/)
  })

  it('never guilts the learner on the way out', () => {
    for (const cadence of [{ buddyDay: 1, intervalWeeks: 2 }, { buddyDay: null, intervalWeeks: 2 }]) {
      const text = stepDownCopy(cadence).toLowerCase()
      for (const word of ['sorry to see', 'giving up', 'quit', 'abandon']) {
        expect(text).not.toContain(word)
      }
    }
  })
})
