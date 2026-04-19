import type { Db } from '@kanji-learn/db'
import type { BuddyLLMRouter } from '../services/llm/router.js'
import type { DualWriteService } from '../services/buddy/dual-write.service.js'
import type { LearnerStateService } from '../services/buddy/learner-state.service.js'
import type { KanjiReadingsIndex } from '../services/kanji-readings-index.js'

declare module 'fastify' {
  interface FastifyInstance {
    db: Db
    buddyLLM: BuddyLLMRouter
    dualWrite: DualWriteService
    learnerState: LearnerStateService
    kanjiReadingsIndex: KanjiReadingsIndex
  }
}
