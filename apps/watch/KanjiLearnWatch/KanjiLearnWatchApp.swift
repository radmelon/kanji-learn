// KanjiLearnWatchApp.swift
// Entry point for the Kanji-Learn Watch app.
//
// Responsibilities:
//   - Bootstrap WatchSessionManager (WatchConnectivity) on launch
//   - Request local notification permissions on first launch
//   - Schedule first BGTaskScheduler background refresh
//   - Handle background app refresh via SwiftUI .backgroundTask() modifier

import SwiftUI
import UserNotifications

@main
struct KanjiLearnWatchApp: App {

    @StateObject private var watchSession = WatchSessionManager.shared
    @StateObject private var studyViewModel = StudyViewModel()

    init() {
        WatchSessionManager.shared.activate()
        requestNotificationPermission()
    }

    var body: some Scene {
        WindowGroup {
            HomeView()
                .environmentObject(watchSession)
                .environmentObject(studyViewModel)
                .onAppear {
                    // Schedule after app is fully initialized
                    BackgroundRefreshHandler.shared.scheduleNextRefresh()
                }
        }
        // Executes every ~2 hours when the system grants a background wakeup.
        // The identifier must appear in BGTaskSchedulerPermittedIdentifiers in Info.plist.
        .backgroundTask(.appRefresh(backgroundRefreshID)) {
            await BackgroundRefreshHandler.shared.performRefresh()
            BackgroundRefreshHandler.shared.scheduleNextRefresh()
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
