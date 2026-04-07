import cron from 'node-cron'
import { NotificationService } from './services/notification.service.js'
import type { Db } from '@kanji-learn/db'

/**
 * Schedules the daily push notification reminder.
 * Runs every hour and sends to users whose reminderHour (in their timezone) matches the current UTC hour.
 * Users who have already studied today are skipped.
 */
export function scheduleDailyReminders(db: Db): void {
  const notifications = new NotificationService(db)

  // Run at the top of every hour
  cron.schedule('0 * * * *', async () => {
    console.log('[Cron] Running hourly reminder check…')
    try {
      await notifications.sendDailyReminders()
    } catch (err) {
      console.error('[Cron] Daily reminder failed:', err)
    }
    try {
      await notifications.sendRestDaySummaries()
    } catch (err) {
      console.error('[Cron] Rest-day summary failed:', err)
    }
  })

  console.log('[Cron] Hourly reminder scheduler started')
}
