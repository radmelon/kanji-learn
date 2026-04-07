// KanjiLearnWatchApp.swift
// Entry point for the Kanji-Learn Watch app.
//
// Responsibilities:
//   - Bootstrap WatchSessionManager (WatchConnectivity) on launch
//   - Wire ExtensionDelegate for background task routing
//   - Set root view to HomeView
//   - Request local notification permissions on first launch
//   - Schedule first background refresh

import SwiftUI
import UserNotifications

@main
struct KanjiLearnWatchApp: App {

    // Routes WKApplicationRefreshBackgroundTask → BackgroundRefreshHandler
    @WKExtensionDelegateAdaptor(ExtensionDelegate.self) private var extensionDelegate

    @StateObject private var watchSession = WatchSessionManager.shared
    @StateObject private var studyViewModel = StudyViewModel()

    init() {
        // Activate WatchConnectivity session as early as possible so the
        // iPhone can push auth tokens before the user tries to study.
        WatchSessionManager.shared.activate()
        requestNotificationPermission()
        // Kick off the first background refresh cycle on launch.
        // Subsequent refreshes are re-scheduled by BackgroundRefreshHandler.
        BackgroundRefreshHandler.shared.scheduleNextRefresh()
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
