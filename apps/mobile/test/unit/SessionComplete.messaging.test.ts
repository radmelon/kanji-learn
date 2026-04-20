import { motivationalMessage } from '../../src/components/study/SessionComplete.messaging'

describe('motivationalMessage', () => {
  it('returns the burned override when burned > 0', () => {
    expect(motivationalMessage(67, 3)).toBe('🔥 3 kanji burned — locked into long-term memory!')
  })

  it('returns the perfect message for accuracy === 100', () => {
    expect(motivationalMessage(100, 0)).toBe('Perfect — effortless recall.')
  })

  it('returns the strong message for accuracy >= 85', () => {
    expect(motivationalMessage(90, 0)).toBe('Strong — most of these felt easy.')
    expect(motivationalMessage(85, 0)).toBe('Strong — most of these felt easy.')
  })

  it('returns the solid message for accuracy >= 60 (includes all-Good 67%)', () => {
    expect(motivationalMessage(67, 0)).toBe('Solid — consistent recall.')
    expect(motivationalMessage(60, 0)).toBe('Solid — consistent recall.')
    expect(motivationalMessage(84, 0)).toBe('Solid — consistent recall.')
  })

  it('returns the mixed message for accuracy in [35, 60)', () => {
    expect(motivationalMessage(59, 0)).toBe('Mixed — some cards still need work.')
    expect(motivationalMessage(35, 0)).toBe('Mixed — some cards still need work.')
  })

  it('returns the rough-patch message for accuracy < 35', () => {
    expect(motivationalMessage(34, 0)).toBe('Rough patch — come back tomorrow.')
    expect(motivationalMessage(0, 0)).toBe('Rough patch — come back tomorrow.')
  })
})
