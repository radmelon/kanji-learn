import type { JlptLevel, PlacementResult } from './types'

const LEVELS: JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1']
const MAX_QUESTIONS = 60
const WINDOW_SIZE = 5
const PASS_THRESHOLD = 0.7
const FAIL_THRESHOLD = 0.3

export class PlacementEngine {
  private currentLevel: JlptLevel = 'N3'
  private recentWindow: boolean[] = []
  private testedIds = new Set<number>()
  private results: PlacementResult[] = []
  private totalAsked = 0

  getCurrentLevel(): JlptLevel { return this.currentLevel }
  getTestedIds(): number[] { return Array.from(this.testedIds) }
  getTotalAsked(): number { return this.totalAsked }
  isDone(): boolean { return this.totalAsked >= MAX_QUESTIONS }

  recordResult(kanjiId: number, passed: boolean): void {
    this.testedIds.add(kanjiId)
    this.results.push({ kanjiId, passed })
    this.recentWindow.push(passed)
    if (this.recentWindow.length > WINDOW_SIZE) this.recentWindow.shift()
    this.totalAsked++

    if (this.recentWindow.length === WINDOW_SIZE) {
      const passRate = this.recentWindow.filter(Boolean).length / WINDOW_SIZE
      const idx = LEVELS.indexOf(this.currentLevel)
      if (passRate >= PASS_THRESHOLD && idx < LEVELS.length - 1) {
        this.currentLevel = LEVELS[idx + 1]
      } else if (passRate <= FAIL_THRESHOLD && idx > 0) {
        this.currentLevel = LEVELS[idx - 1]
      }
    }
  }

  getResults(): PlacementResult[] { return [...this.results] }

  getStats(): { passed: number; failed: number; total: number } {
    const passed = this.results.filter((r) => r.passed).length
    return { passed, failed: this.results.length - passed, total: this.results.length }
  }

  getPassedByLevel(kanjiLevelMap: Map<number, JlptLevel>): Partial<Record<JlptLevel, number>> {
    const counts: Partial<Record<JlptLevel, number>> = {}
    for (const r of this.results) {
      if (r.passed) {
        const level = kanjiLevelMap.get(r.kanjiId)
        if (level) counts[level] = (counts[level] ?? 0) + 1
      }
    }
    return counts
  }
}
