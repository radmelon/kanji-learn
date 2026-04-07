// BackgroundRefreshHandler.swift
// Handles WKApplicationRefreshBackgroundTask.
//
// Responsibilities:
//   1. Poll GET /v1/review/status to see if cards are due
//   2. Skip if: user already studied today, before reminderHour, on rest day,
//      or a Watch-originated prompt was sent in the last 4 hours
//   3. Schedule a local UNUserNotificationCenter notification when all conditions pass
//   4. Write due count to App Group UserDefaults so the WidgetKit complication can read it
//   5. Reload WidgetKit timelines so the complication updates
//   6. Schedule the next background refresh in ~2 hours

import Foundation
import UserNotifications
import WidgetKit

// App Group shared between Watch app + Widget extension
private let appGroupID = "group.com.kanji-learn.watch"

// Minimum gap between Watch-originated prompts (4 hours)
private let promptCooldownSec: TimeInterval = 4 * 3600

// How far ahead to schedule the next background refresh
private let refreshIntervalSec: TimeInterval = 2 * 3600

// UserDefaults key for last Watch-prompt timestamp
private let lastPromptKey = "kl_last_watch_prompt"

// ─── Handler ─────────────────────────────────────────────────────────────────

@MainActor
final class BackgroundRefreshHandler {
    static let shared = BackgroundRefreshHandler()
    private init() {}

    /// Called by ExtensionDelegate when a WKApplicationRefreshBackgroundTask fires.
    func handle(_ task: WKApplicationRefreshBackgroundTask) {
        Task {
            await performRefresh()
            scheduleNextRefresh()
            task.setTaskCompletedWithSnapshot(false)
        }
    }

    /// Schedule the next background wake-up ~2 hours from now.
    func scheduleNextRefresh() {
        WKExtension.default().scheduleBackgroundRefresh(
            withPreferredDate: Date(timeIntervalSinceNow: refreshIntervalSec),
            userInfo: nil
        ) { err in
            if let err {
                print("[BackgroundRefresh] scheduleBackgroundRefresh error: \(err)")
            }
        }
    }

    // ── Core logic ─────────────────────────────────────────────────────────────

    private func performRefresh() async {
        // 1. Must have a valid token — otherwise nothing to do
        guard (try? AuthService.shared.getAccessToken()) != nil else { return }

        // 2. Fetch current status
        guard let status = try? await APIClient.shared.fetchStatus() else { return }

        // 3. Write due count to shared App Group so the complication can read it
        updateComplication(dueCount: status.dueCount)

        // 4. Nothing due — no prompt needed
        guard status.dueCount > 0 else { return }

        // 5. Already studied today — no prompt needed
        if (status.todayReviewed ?? 0) > 0 { return }

        // 6. Check user settings (synced from iPhone via WatchConnectivity)
        let defaults = UserDefaults.standard
        let reminderHourRaw = defaults.integer(forKey: "kl_reminder_hour")
        let reminderHour = reminderHourRaw == 0 ? 20 : reminderHourRaw
        let restDayRaw = defaults.integer(forKey: "kl_rest_day_raw") // -1 = none

        let cal = Calendar.current
        let now = Date()
        let currentHour = cal.component(.hour, from: now)
        let currentWeekday = cal.component(.weekday, from: now) - 1 // 0=Sun … 6=Sat

        // Don't prompt before the user's preferred reminder hour
        guard currentHour >= reminderHour else { return }

        // Skip rest day
        if restDayRaw >= 0, currentWeekday == restDayRaw { return }

        // 7. Frequency cap — max one Watch-originated prompt per 4 hours
        if let lastTs = defaults.object(forKey: lastPromptKey) as? Double,
           Date().timeIntervalSince1970 - lastTs < promptCooldownSec {
            return
        }

        // 8. Schedule immediate local notification
        let streak = defaults.integer(forKey: "kl_cached_streak")
        let streakMsg = streak > 0 ? " Keep your \(streak)-day streak alive!" : ""

        let content = UNMutableNotificationContent()
        content.title = "Kanji time!"
        content.body  = "\(status.dueCount) cards waiting.\(streakMsg)"
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "kl_background_prompt",
            content: content,
            trigger: nil // deliver immediately
        )

        do {
            try await UNUserNotificationCenter.current().add(request)
            defaults.set(Date().timeIntervalSince1970, forKey: lastPromptKey)
        } catch {
            print("[BackgroundRefresh] Notification error: \(error)")
        }
    }

    // ── Complication update ─────────────────────────────────────────────────────

    /// Writes the due count to the shared App Group so the WidgetKit
    /// complication can read it, then reloads all Widget timelines.
    func updateComplication(dueCount: Int) {
        UserDefaults(suiteName: appGroupID)?.set(dueCount, forKey: "kl_due_count")
        WidgetCenter.shared.reloadAllTimelines()
    }
}
