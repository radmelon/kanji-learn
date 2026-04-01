import cron from 'node-cron'
import { NotificationService } from './services/notification.service.js'
import type { Db } from '@kanji-learn/db'

/**
 * Schedules the daily push notification reminder.
 * Fires at 8:00 PM local server time every day.
 * Users who haven't studied yet get a streak-aware nudge.
 */
export function scheduleDailyReminders(db: Db): void {
  const notifications = new NotificationService(db)

  // Run at 20:00 every day
  cron.schedule('0 20 * * *', async () => {
    console.log('[Cron] Running daily reminder job…')
    try {
      await notifications.sendDailyReminders()
    } catch (err) {
      console.error('[Cron] Daily reminder failed:', err)
    }
  })

  console.log('[Cron] Daily reminder scheduled for 20:00')
}
