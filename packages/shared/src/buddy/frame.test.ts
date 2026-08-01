import { describe, it, expect } from 'vitest'
import { resolveFrame } from './frame'

describe('resolveFrame', () => {
  it('an explicit ruler always wins, whatever the reasons say', () => {
    expect(resolveFrame({ explicitRuler: 'grade', reasons: ['JLPT exam'] }))
      .toEqual({ kind: 'chosen', ruler: 'grade' })
  })
  it('infers jlpt from the jlpt group, reporting which reasons matched', () => {
    expect(resolveFrame({ reasons: ['JLPT exam', 'Anime / Manga'] }))
      .toEqual({ kind: 'inferred', ruler: 'jlpt', from: ['JLPT exam'] })
  })
  it('infers grade from the grade group', () => {
    expect(resolveFrame({ reasons: ['Heritage'] }))
      .toEqual({ kind: 'inferred', ruler: 'grade', from: ['Heritage'] })
  })
  it('asks when no reasons are given', () => {
    expect(resolveFrame({ reasons: [] })).toEqual({ kind: 'ask' })
  })
  it('asks when no reason matches either group', () => {
    expect(resolveFrame({ reasons: ['Travel', 'Anime / Manga'] })).toEqual({ kind: 'ask' })
  })
  it('asks when BOTH groups are present', () => {
    expect(resolveFrame({ reasons: ['Work / Business', 'Curiosity'] })).toEqual({ kind: 'ask' })
  })
})
