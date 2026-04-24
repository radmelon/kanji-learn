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
    @Published var isAuthenticated: Bool = false

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
        // Reflect any tokens already stored from a previous session
        isAuthenticated = AuthService.shared.isAuthenticated
        // Restore the API base URL from keychain — it is not held in memory across
        // process relaunches, so every launch must reload it before API calls fire.
        AuthService.shared.restoreBaseURL()
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
        let ts = Int(Date().timeIntervalSince1970 * 1000)
        let stateStr: String
        switch activationState {
        case .notActivated: stateStr = "notActivated"
        case .inactive:     stateStr = "inactive"
        case .activated:    stateStr = "activated"
        @unknown default:   stateStr = "unknown(\(activationState.rawValue))"
        }
        let keychainHasToken = AuthService.shared.isAuthenticated ? 1 : 0
        let errStr = error.map { $0.localizedDescription } ?? "nil"
        print("[KL-Watch] \(ts) activation state=\(stateStr) reachable=\(session.isReachable) keychainHasToken=\(keychainHasToken) err=\(errStr)")

        DispatchQueue.main.async {
            self.isReachable = session.isReachable
            self.updateConnectionStatus(session)
        }
        if let error {
            print("[KL-Watch] \(ts) activation-error \(error)")
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        let ts = Int(Date().timeIntervalSince1970 * 1000)
        print("[KL-Watch] \(ts) reachabilityDidChange reachable=\(session.isReachable)")
        DispatchQueue.main.async {
            self.isReachable = session.isReachable
            self.updateConnectionStatus(session)
        }
    }

    // Receives tokens + settings pushed by iPhone via updateApplicationContext()
    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        let ts = Int(Date().timeIntervalSince1970 * 1000)
        let pushReason = applicationContext["pushReason"] as? String ?? "unknown"
        let pushTsMs   = applicationContext["pushTsMs"]   as? Int ?? 0
        let latencyMs  = pushTsMs > 0 ? ts - pushTsMs : -1
        let keys = applicationContext.keys.sorted().joined(separator: ",")

        guard
            let accessToken  = applicationContext["accessToken"]  as? String,
            let refreshToken = applicationContext["refreshToken"] as? String,
            let expiresAt    = applicationContext["expiresAt"]    as? Double,
            let supabaseURL  = applicationContext["supabaseURL"]  as? String,
            let apiBaseURL   = applicationContext["apiBaseURL"]   as? String
        else {
            print("[KL-Watch] \(ts) contextReceived reason=\(pushReason) latencyMs=\(latencyMs) result=missing-fields keys=[\(keys)]")
            return
        }

        let expiry = Date(timeIntervalSince1970: expiresAt)
        let expiresInSec = Int(expiry.timeIntervalSinceNow)
        AuthService.shared.store(
            accessToken:  accessToken,
            refreshToken: refreshToken,
            expiresAt:    expiry,
            supabaseURL:  supabaseURL,
            apiBaseURL:   apiBaseURL
        )

        var settingsApplied: [String] = []
        if let watchEnabled = applicationContext["watchEnabled"] as? Bool {
            UserDefaults.standard.set(watchEnabled, forKey: "kl_watch_enabled")
            settingsApplied.append("watchEnabled=\(watchEnabled)")
        }
        if let dailyGoal = applicationContext["dailyGoal"] as? Int {
            UserDefaults.standard.set(dailyGoal, forKey: "kl_daily_goal")
            settingsApplied.append("dailyGoal=\(dailyGoal)")
        }
        if let reminderHour = applicationContext["reminderHour"] as? Int {
            UserDefaults.standard.set(reminderHour, forKey: "kl_reminder_hour")
            settingsApplied.append("reminderHour=\(reminderHour)")
        }
        if let restDay = applicationContext["restDay"] as? Int {
            UserDefaults.standard.set(restDay, forKey: "kl_rest_day")
            settingsApplied.append("restDay=\(restDay)")
        } else {
            UserDefaults.standard.removeObject(forKey: "kl_rest_day")
            settingsApplied.append("restDay=nil")
        }

        DispatchQueue.main.async {
            self.isAuthenticated = true
        }

        print("[KL-Watch] \(ts) contextReceived reason=\(pushReason) latencyMs=\(latencyMs) result=applied expiresInSec=\(expiresInSec) settings=[\(settingsApplied.joined(separator: ","))]")
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
