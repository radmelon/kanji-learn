import { describe, it, expect } from 'vitest'
import { planQueueSlots } from '../../src/services/srs.service'

describe('planQueueSlots', () => {
  it('reserves the new-kanji floor on a heavy review day', () => {
    // 100 due, plenty of new, limit 50, floor 4
    expect(planQueueSlots(100, 100, 50, 4)).toEqual({ guaranteedNew: 4, dueKeep: 46, fillNew: 0 })
  })
  it('lets new cards fill leftover slots when due is light', () => {
    expect(planQueueSlots(10, 100, 50, 4)).toEqual({ guaranteedNew: 4, dueKeep: 10, fillNew: 36 })
  })
  it('fills entirely with new cards when nothing is due', () => {
    expect(planQueueSlots(0, 100, 50, 4)).toEqual({ guaranteedNew: 4, dueKeep: 0, fillNew: 46 })
  })
  it('caps the floor at the number of new cards actually available', () => {
    expect(planQueueSlots(100, 2, 50, 4)).toEqual({ guaranteedNew: 2, dueKeep: 48, fillNew: 0 })
  })
  it('gives all slots to due when there are no new cards', () => {
    expect(planQueueSlots(100, 0, 50, 4)).toEqual({ guaranteedNew: 0, dueKeep: 50, fillNew: 0 })
  })
  it('never exceeds the limit when due + new are both small', () => {
    const s = planQueueSlots(20, 5, 50, 4)
    expect(s).toEqual({ guaranteedNew: 4, dueKeep: 20, fillNew: 1 })
    expect(s.guaranteedNew + s.dueKeep + s.fillNew).toBeLessThanOrEqual(50)
  })
})
