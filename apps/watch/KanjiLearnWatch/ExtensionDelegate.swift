// ExtensionDelegate.swift
// WKExtensionDelegate that routes background tasks to the appropriate handler.
//
// Background task types handled:
//   • WKApplicationRefreshBackgroundTask → BackgroundRefreshHandler
//   • All others → completed immediately (no snapshot needed)

import WatchKit

final class ExtensionDelegate: NSObject, WKExtensionDelegate {

    func handle(_ backgroundTasks: Set<WKRefreshBackgroundTask>) {
        for task in backgroundTasks {
            switch task {
            case let refreshTask as WKApplicationRefreshBackgroundTask:
                Task { @MainActor in
                    await BackgroundRefreshHandler.shared.handle(refreshTask)
                }
            default:
                task.setTaskCompletedWithSnapshot(false)
            }
        }
    }
}
