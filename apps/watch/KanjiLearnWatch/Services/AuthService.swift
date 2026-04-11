// AuthService.swift
// Manages Supabase JWT tokens on the Watch.
//
// Token lifecycle:
//   1. iPhone pushes tokens via WatchConnectivity -> WatchSessionManager -> AuthService.store()
//   2. APIClient calls AuthService.getAccessToken() before each request
//   3. If access token is expired, AuthService.refresh() exchanges the refresh token
//      autonomously via Supabase's /auth/v1/token?grant_type=refresh_token endpoint
//   4. If both tokens are absent or refresh fails, throws APIError.notAuthenticated

import Foundation
import Security

// ─── Token bundle ─────────────────────────────────────────────────────────────

struct AuthTokens {
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date        // when the access token expires
    let supabaseURL: String    // e.g. "https://xyz.supabase.co"
}

// ─── Keychain keys ────────────────────────────────────────────────────────────

private enum KeychainKey {
    static let accessToken  = "kl_watch_access_token"
    static let refreshToken = "kl_watch_refresh_token"
    static let expiresAt    = "kl_watch_expires_at"
    static let supabaseURL  = "kl_watch_supabase_url"
    static let apiBaseURL   = "kl_watch_api_base_url"
}

// ─── AuthService ──────────────────────────────────────────────────────────────

final class AuthService {
    static let shared = AuthService()

    private init() {}

    // ── Token storage ─────────────────────────────────────────────────────────

    /// Store tokens received from iPhone via WatchConnectivity.
    func store(tokens: AuthTokens) {
        save(key: KeychainKey.accessToken,  value: tokens.accessToken)
        save(key: KeychainKey.refreshToken, value: tokens.refreshToken)
        save(key: KeychainKey.expiresAt,    value: String(tokens.expiresAt.timeIntervalSince1970))
        save(key: KeychainKey.supabaseURL,  value: tokens.supabaseURL)

        // Configure APIClient base URL from Supabase project URL convention:
        // The API server URL is stored separately in app context; here we just
        // persist the Supabase URL for token refresh.
    }

    /// Store individual fields received from WatchConnectivity applicationContext.
    func store(accessToken: String, refreshToken: String, expiresAt: Date, supabaseURL: String, apiBaseURL: String) {
        save(key: KeychainKey.accessToken,  value: accessToken)
        save(key: KeychainKey.refreshToken, value: refreshToken)
        save(key: KeychainKey.expiresAt,    value: String(expiresAt.timeIntervalSince1970))
        save(key: KeychainKey.supabaseURL,  value: supabaseURL)
        save(key: KeychainKey.apiBaseURL,   value: apiBaseURL)
        APIClient.shared.baseURL = apiBaseURL
    }

    /// Restore the API base URL from keychain into APIClient after process relaunch.
    func restoreBaseURL() {
        if let url = load(key: KeychainKey.apiBaseURL), !url.isEmpty {
            APIClient.shared.baseURL = url
        }
    }

    var isAuthenticated: Bool {
        load(key: KeychainKey.accessToken) != nil
    }

    // ── Token retrieval (used by APIClient) ───────────────────────────────────

    /// Returns a valid (non-expired) access token, refreshing autonomously if needed.
    func getAccessToken() async throws -> String {
        guard let accessToken = load(key: KeychainKey.accessToken) else {
            throw APIError.notAuthenticated
        }

        // Check expiry — refresh if within 60 seconds of expiry
        if let expiresAtStr = load(key: KeychainKey.expiresAt),
           let expiresAtTs = Double(expiresAtStr) {
            let expiresAt = Date(timeIntervalSince1970: expiresAtTs)
            if Date().addingTimeInterval(60) >= expiresAt {
                return try await refresh()
            }
        }

        return accessToken
    }

    // ── Autonomous token refresh ───────────────────────────────────────────────

    @discardableResult
    func refresh() async throws -> String {
        guard let refreshToken = load(key: KeychainKey.refreshToken),
              let supabaseURL  = load(key: KeychainKey.supabaseURL) else {
            throw APIError.notAuthenticated
        }

        guard let url = URL(string: "\(supabaseURL)/auth/v1/token?grant_type=refresh_token") else {
            throw APIError.parseError("Invalid Supabase URL")
        }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(["refresh_token": refreshToken])

        let (data, response) = try await URLSession.shared.data(for: req)

        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            // Refresh token is invalid or expired — need re-auth via iPhone
            clear()
            throw APIError.notAuthenticated
        }

        struct RefreshResponse: Decodable {
            let access_token: String
            let refresh_token: String
            let expires_in: Int
        }

        let body = try JSONDecoder().decode(RefreshResponse.self, from: data)
        let newExpiry = Date().addingTimeInterval(TimeInterval(body.expires_in))

        save(key: KeychainKey.accessToken,  value: body.access_token)
        save(key: KeychainKey.refreshToken, value: body.refresh_token)
        save(key: KeychainKey.expiresAt,    value: String(newExpiry.timeIntervalSince1970))

        return body.access_token
    }

    // ── Sign out ──────────────────────────────────────────────────────────────

    func clear() {
        delete(key: KeychainKey.accessToken)
        delete(key: KeychainKey.refreshToken)
        delete(key: KeychainKey.expiresAt)
        delete(key: KeychainKey.supabaseURL)
        delete(key: KeychainKey.apiBaseURL)
        APIClient.shared.baseURL = ""
    }

    // ── Keychain helpers ──────────────────────────────────────────────────────

    private func save(key: String, value: String) {
        let data = Data(value.utf8)
        let query: [CFString: Any] = [
            kSecClass:       kSecClassGenericPassword,
            kSecAttrAccount: key,
            kSecValueData:   data,
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlock,
        ]
        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }

    private func load(key: String) -> String? {
        let query: [CFString: Any] = [
            kSecClass:            kSecClassGenericPassword,
            kSecAttrAccount:      key,
            kSecReturnData:       true,
            kSecMatchLimit:       kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess,
              let data = result as? Data,
              let string = String(data: data, encoding: .utf8) else {
            return nil
        }
        return string
    }

    private func delete(key: String) {
        let query: [CFString: Any] = [
            kSecClass:       kSecClassGenericPassword,
            kSecAttrAccount: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
