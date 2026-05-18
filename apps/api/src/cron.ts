import cron from 'node-cron'
import { TutorAnalysisService } from './services/tutor-analysis.service.js'
import type { Db } from '@kanji-learn/db'

// Daily reminders + rest-day summaries are NOT scheduled here. They run off the
// external EventBridge Rule `kanji-learn-hourly-reminders` → Lambda →
// POST /internal/daily-reminders. An in-app node-cron would double-fire once
// per App Runner instance whenever the service scales past one instance.

export function scheduleTutorAnalysis(db: Db, llm: any): void {
  const analysisService = new TutorAnalysisService(db, llm)

  // Run daily at 03:00 UTC (off-peak)
  cron.schedule('0 3 * * *', async () => {
    console.log('[Cron] Running daily tutor analysis…')
    try {
      const result = await analysisService.computeAllActive()
      console.log(`[Cron] Tutor analysis complete: ${result.computed} computed, ${result.errors} errors`)
    } catch (err) {
      console.error('[Cron] Tutor analysis failed:', err)
    }
  })

  console.log('[Cron] Daily tutor analysis scheduler started')
}
