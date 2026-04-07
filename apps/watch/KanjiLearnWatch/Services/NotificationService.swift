// NotificationService.swift
// Local notifications for study session delay/snooze.
// Phase 4 will add the full delay picker integration. This Phase 1 stub
// provides the scheduling and cancellation primitives.

import Foundation
import UserNotifications

enum DelayOption: CaseIterable, Identifiable {
    case oneHour
    case twoHours
    case fourHours
    case tonight     // 8 PM local
    case tomorrow    // 8 AM next day

    var id: String { displayTitle }

    var displayTitle: String {
        switch self {
        case .oneHour:   return "1 hour"
        case .twoHours:  return "2 hours"
        case .fourHours: return "4 hours"
        case .tonight:   return "Tonight"
        case .tomorrow:  return "Tomorrow morning"
        }
    }

    /// Returns the fire date for this delay option.
    func fireDate() -> Date {
        let now = Date()
        let cal = Calendar.current
        switch self {
        case .oneHour:
            return now.addingTimeInterval(3600)
        case .twoHours:
            return now.addingTimeInterval(7200)
        case .fourHours:
            return now.addingTimeInterval(14400)
        case .tonight:
            // 8 PM today — if already past 8 PM, use tomorrow 8 PM
            var comps = cal.dateComponents([.year, .month, .day], from: now)
            comps.hour = 20; comps.minute = 0; comps.second = 0
            let target = cal.date(from: comps)!
            return target > now ? target : target.addingTimeInterval(86400)
        case .tomorrow:
            // 8 AM tomorrow
            var comps = cal.dateComponents([.year, .month, .day], from: now)
            comps.hour = 8; comps.minute = 0; comps.second = 0
            let today8am = cal.date(from: comps)!
            return today8am.addingTimeInterval(86400)
        }
    }
}

final class NotificationService {
    static let shared = NotificationService()
    private init() {}

    private let delayIdentifier = "kl_watch_study_delay"

    /// Schedule a local study reminder after the given delay option.
    /// Stores the fire date in UserDefaults so HomeView can suppress the study prompt.
    func scheduleDelay(_ option: DelayOption, dueCount: Int) {
        let fireDate = option.fireDate()
        UserDefaults.standard.set(fireDate.timeIntervalSince1970, forKey: "kl_delay_until")

        let content = UNMutableNotificationContent()
        content.title = "Time to study!"
        content.body  = dueCount > 0
            ? "You have \(dueCount) kanji waiting."
            : "Your kanji are waiting for review."
        content.sound = .default

        let components = Calendar.current.dateComponents(
            [.year, .month, .day, .hour, .minute, .second],
            from: fireDate
        )
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        let request = UNNotificationRequest(
            identifier: delayIdentifier,
            content: content,
            trigger: trigger
        )

        UNUserNotificationCenter.current().removePendingNotificationRequests(
            withIdentifiers: [delayIdentifier]
        )
        UNUserNotificationCenter.current().add(request) { error in
            if let error {
                print("[NotificationService] Schedule error: \(error)")
            }
        }
    }

    /// Cancel any pending delay notification and clear the delay timestamp.
    func cancelDelay() {
        UNUserNotificationCenter.current().removePendingNotificationRequests(
            withIdentifiers: [delayIdentifier]
        )
        UserDefaults.standard.removeObject(forKey: "kl_delay_until")
    }

    /// Returns true if the user has an active delay that hasn't expired yet.
    var isDelayed: Bool {
        guard let ts = UserDefaults.standard.object(forKey: "kl_delay_until") as? Double else {
            return false
        }
        return Date(timeIntervalSince1970: ts) > Date()
    }

    /// Returns the delay expiry date if active.
    var delayUntil: Date? {
        guard let ts = UserDefaults.standard.object(forKey: "kl_delay_until") as? Double else {
            return nil
        }
        let date = Date(timeIntervalSince1970: ts)
        return date > Date() ? date : nil
    }
}
