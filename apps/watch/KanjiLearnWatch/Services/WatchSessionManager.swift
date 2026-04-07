// WatchSessionManager.swift
// WCSessionDelegate that receives auth tokens and settings from the iPhone app.
//
// Phase 2 will flesh out the full bidirectional sync. This Phase 1 stub:
//   - Activates the WCSession
//   - Receives applicationContext payloads pushed by the iPhone
//   - Stores tokens in AuthService and updates APIClient.baseURL
//   - Exposes connection state for the iOS Settings toggle status line

import Foundation
import WatchConnectivity
import SwiftUI

final class WatchSessionManager: NSObject, ObservableObject {
    static let shared = WatchSessionManager()

    @Published var isReachable: Bool = false
    @Published var isPaired: Bool = false
    @Published var isWatchAppInstalled: Bool = false  // always true on Watch side
    @Published var connectionStatus: ConnectionStatus = .unknown

    enum ConnectionStatus {
        case unknown
        case notPaired
        case appNotInstalled
        case connected
        case disconnected

        var displayText: String {
            switch self {
            case .unknown:          return "Checking..."
            case .notPaired:        return "iPhone not paired"
            case .appNotInstalled:  return "iPhone app not installed"
            case .connected:        return "Connected"
            case .disconnected:     return "iPhone out of range"
            }
        }
    }

    private var session: WCSession?

    private override init() { super.init() }

    func activate() {
        guard WCSession.isSupported() else { return }
        let s = WCSession.default
        s.delegate = self
        s.activate()
        session = s
    }

    // ── Send message to iPhone (e.g. request token refresh) ──────────────────

    func sendMessage(_ message: [String: Any]) {
        guard let session, session.isReachable else { return }
        session.sendMessage(message, replyHandler: nil, errorHandler: { error in
            print("[WatchSessionManager] sendMessage error: \(error)")
        })
    }
}

// ─── WCSessionDelegate ────────────────────────────────────────────────────────

extension WatchSessionManager: WCSessionDelegate {

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        DispatchQueue.main.async {
            self.isReachable = session.isReachable
            self.updateConnectionStatus(session)
        }
        if let error {
            print("[WatchSessionManager] Activation error: \(error)")
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async {
            self.isReachable = session.isReachable
            self.updateConnectionStatus(session)
        }
    }

    // Receives tokens + settings pushed by iPhone via updateApplicationContext()
    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        guard
            let accessToken  = applicationContext["accessToken"]  as? String,
            let refreshToken = applicationContext["refreshToken"] as? String,
            let expiresAt    = applicationContext["expiresAt"]    as? Double,
            let supabaseURL  = applicationContext["supabaseURL"]  as? String,
            let apiBaseURL   = applicationContext["apiBaseURL"]   as? String
        else {
            print("[WatchSessionManager] Received applicationContext missing required token fields")
            return
        }

        let expiry = Date(timeIntervalSince1970: expiresAt)
        AuthService.shared.store(
            accessToken:  accessToken,
            refreshToken: refreshToken,
            expiresAt:    expiry,
            supabaseURL:  supabaseURL,
            apiBaseURL:   apiBaseURL
        )

        // Optionally receive cached profile settings for delay encouragement
        if let watchEnabled = applicationContext["watchEnabled"] as? Bool {
            UserDefaults.standard.set(watchEnabled, forKey: "kl_watch_enabled")
        }
        if let dailyGoal = applicationContext["dailyGoal"] as? Int {
            UserDefaults.standard.set(dailyGoal, forKey: "kl_daily_goal")
        }
        if let reminderHour = applicationContext["reminderHour"] as? Int {
            UserDefaults.standard.set(reminderHour, forKey: "kl_reminder_hour")
        }
        if let restDay = applicationContext["restDay"] as? Int {
            UserDefaults.standard.set(restDay, forKey: "kl_rest_day")
        } else {
            UserDefaults.standard.removeObject(forKey: "kl_rest_day")
        }

        print("[WatchSessionManager] Auth tokens and settings received from iPhone")
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private func updateConnectionStatus(_ session: WCSession) {
        if session.isReachable {
            connectionStatus = .connected
        } else {
            connectionStatus = .disconnected
        }
    }
}
