// KanjiLearnWatchApp.swift
// Entry point for the Kanji-Learn Watch app.
//
// Responsibilities:
//   - Bootstrap WatchSessionManager (WatchConnectivity) on launch
//   - Set root view to HomeView
//   - Request local notification permissions on first launch

import SwiftUI
import UserNotifications

@main
struct KanjiLearnWatchApp: App {

    @StateObject private var watchSession = WatchSessionManager.shared
    @StateObject private var studyViewModel = StudyViewModel()

    init() {
        // Activate WatchConnectivity session as early as possible so the
        // iPhone can push auth tokens before the user tries to study.
        WatchSessionManager.shared.activate()
        requestNotificationPermission()
    }

    var body: some Scene {
        WindowGroup {
            HomeView()
                .environmentObject(watchSession)
                .environmentObject(studyViewModel)
        }
    }

    // ── Notification permission ───────────────────────────────────────────────

    private func requestNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .sound, .badge]
        ) { granted, error in
            if let error {
                print("[KanjiLearnWatch] Notification permission error: \(error)")
            }
        }
    }
}
