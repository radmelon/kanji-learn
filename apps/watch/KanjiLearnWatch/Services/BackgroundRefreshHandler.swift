// BackgroundRefreshHandler.swift
// Polls GET /v1/review/status on a ~2-hour background schedule.
//
// Scheduling: WKExtension.default().scheduleBackgroundRefresh (watchOS-specific).
// Handling:   SwiftUI .backgroundTask(.appRefresh) modifier in KanjiLearnWatchApp.
//
// Conditions checked before firing a local prompt:
//   • Cards are due (status.dueCount > 0)
//   • User hasn't studied today (status.todayReviewed == 0)
//   • Current hour >= reminderHour (respect user preference)
//   • Today is not the user's rest day
//   • Last Watch-originated prompt was > 4 hours ago (anti-spam)

import Foundation
import UserNotifications
import WidgetKit
import WatchKit

// App Group shared between Watch app + Widget Extension
let watchAppGroupID = "group.com.kanji-learn.watch"

// Must match the identifier used in .backgroundTask(.appRefresh) in KanjiLearnWatchApp
let backgroundRefreshID = "com.rdennis.kanjilearn2.watchkitapp.refresh"

private let promptCooldownSec: TimeInterval = 4 * 3600
private let refreshIntervalSec: TimeInterval = 2 * 3600
private let lastPromptKey = "kl_last_watch_prompt"

// ─── Handler ─────────────────────────────────────────────────────────────────

final class BackgroundRefreshHandler {
    static let shared = BackgroundRefreshHandler()
    private init() {}

    /// Fetch status, conditionally prompt, update complication.
    /// Called from .backgroundTask(.appRefresh) in KanjiLearnWatchApp.
    func performRefresh() async {
        guard (try? await AuthService.shared.getAccessToken()) != nil else { return }
        guard let status = try? await APIClient.shared.fetchStatus() else { return }

        // Always update complication with latest count
        updateComplication(dueCount: status.dueCount)

        guard status.dueCount > 0 else { return }
        guard (status.todayReviewed ?? 0) == 0 else { return }

        let defaults = UserDefaults.standard
        let reminderHourRaw = defaults.integer(forKey: "kl_reminder_hour")
        let reminderHour = reminderHourRaw == 0 ? 20 : reminderHourRaw
        let restDayRaw = defaults.integer(forKey: "kl_rest_day_raw") // -1 = no rest day

        let cal = Calendar.current
        let now = Date()
        let currentHour = cal.component(.hour, from: now)
        let currentWeekday = cal.component(.weekday, from: now) - 1 // 0=Sun

        guard currentHour >= reminderHour else { return }
        if restDayRaw >= 0, currentWeekday == restDayRaw { return }

        // Frequency cap: max one Watch-originated prompt per 4 hours
        if let lastTs = defaults.object(forKey: lastPromptKey) as? Double,
           Date().timeIntervalSince1970 - lastTs < promptCooldownSec { return }

        // Fire immediate local notification
        let streak = defaults.integer(forKey: "kl_cached_streak")
        let streakSuffix = streak > 0 ? " Keep your \(streak)-day streak alive!" : ""

        let content = UNMutableNotificationContent()
        content.title = "Kanji time!"
        content.body  = "\(status.dueCount) cards waiting.\(streakSuffix)"
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "kl_background_prompt",
            content: content,
            trigger: nil
        )
        do {
            try await UNUserNotificationCenter.current().add(request)
            defaults.set(Date().timeIntervalSince1970, forKey: lastPromptKey)
        } catch {
            print("[BackgroundRefresh] Notification error: \(error)")
        }
    }

    /// Schedule the next background wake ~2 hours from now.
    /// Call this after each background task completes and once on first launch.
    func scheduleNextRefresh() {
        WKApplication.shared().scheduleBackgroundRefresh(
            withPreferredDate: Date(timeIntervalSinceNow: refreshIntervalSec),
            userInfo: nil as (NSSecureCoding & NSObject)?
        ) { error in
            if let error {
                print("[BackgroundRefresh] scheduleBackgroundRefresh error: \(error)")
            }
        }
    }

    // ── Complication ────────────────────────────────────────────────────────────

    /// Write due count to the shared App Group and reload Widget timelines.
    func updateComplication(dueCount: Int) {
        UserDefaults(suiteName: watchAppGroupID)?.set(dueCount, forKey: "kl_due_count")
        WidgetCenter.shared.reloadAllTimelines()
    }
}
