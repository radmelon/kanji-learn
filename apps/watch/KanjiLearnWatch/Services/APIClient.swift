// APIClient.swift
// URLSession-based REST client for the Kanji-Learn Fastify API.
// Mirrors the pattern in apps/mobile/src/lib/api.ts:
//   - Authorization: Bearer <token> on every request
//   - Decodes { ok: true, data: T } envelope
//   - Throws APIError on { ok: false } or network failures
//   - Retries GET requests once on transient network / 503 errors

import Foundation

// ─── Errors ───────────────────────────────────────────────────────────────────

enum APIError: LocalizedError {
    case notAuthenticated
    case networkError(Error)
    case httpError(statusCode: Int, code: String, message: String)
    case decodingError(Error)
    case parseError(String)

    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return "Not authenticated. Please open the iPhone app to sync your credentials."
        case .networkError(let err):
            return "Network error: \(err.localizedDescription)"
        case .httpError(let status, _, let msg):
            return "Server error (\(status)): \(msg)"
        case .decodingError(let err):
            return "Decoding error: \(err.localizedDescription)"
        case .parseError(let msg):
            return "Parse error: \(msg)"
        }
    }
}

// ─── Raw API envelope ─────────────────────────────────────────────────────────

// Used for decoding error responses: { ok: false, error: "...", code: "..." }
private struct APIErrorEnvelope: Decodable {
    let ok: Bool
    let error: String?
    let code: String?
}

// ─── APIClient ────────────────────────────────────────────────────────────────

final class APIClient {
    static let shared = APIClient()

    // Injected at startup from build config / WatchConnectivity context
    var baseURL: String = ""

    private let session: URLSession
    private let decoder: JSONDecoder

    init(session: URLSession = .shared) {
        self.session = session
        self.decoder = JSONDecoder()
        // API uses camelCase keys matching Swift property names directly
        self.decoder.keyDecodingStrategy = .convertFromSnakeCase
    }

    // ── Core request ──────────────────────────────────────────────────────────

    private func request<T: Decodable>(
        path: String,
        method: String = "GET",
        body: (any Encodable)? = nil,
        attempt: Int = 1
    ) async throws -> T {
        guard !baseURL.isEmpty else {
            throw APIError.parseError("API base URL not configured")
        }

        let token = try AuthService.shared.getAccessToken()

        guard var url = URL(string: baseURL + path) else {
            throw APIError.parseError("Invalid URL: \(baseURL + path)")
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }

        let data: Data
        let response: URLResponse

        do {
            (data, response) = try await session.data(for: request)
        } catch {
            // Retry GET once on transient network failure
            if attempt == 1, method == "GET" {
                try await Task.sleep(nanoseconds: 800_000_000)
                return try await self.request(path: path, method: method, body: body, attempt: 2)
            }
            throw APIError.networkError(error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.parseError("Non-HTTP response")
        }

        // Retry GET once on 503
        if http.statusCode == 503, attempt == 1, method == "GET" {
            try await Task.sleep(nanoseconds: 800_000_000)
            return try await self.request(path: path, method: method, body: body, attempt: 2)
        }

        // Parse error envelope on failure
        if http.statusCode >= 400 {
            if let envelope = try? JSONDecoder().decode(APIErrorEnvelope.self, from: data) {
                throw APIError.httpError(
                    statusCode: http.statusCode,
                    code: envelope.code ?? "UNKNOWN",
                    message: envelope.error ?? "Unknown error"
                )
            }
            throw APIError.httpError(
                statusCode: http.statusCode,
                code: "HTTP_\(http.statusCode)",
                message: HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
            )
        }

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }

    // ── Public methods ────────────────────────────────────────────────────────

    func get<T: Decodable>(_ path: String) async throws -> T {
        try await request(path: path, method: "GET")
    }

    func post<T: Decodable>(_ path: String, body: (any Encodable)? = nil) async throws -> T {
        try await request(path: path, method: "POST", body: body)
    }

    // ── Domain methods ────────────────────────────────────────────────────────

    /// Fetch the review queue. Watch uses limit=10 (smaller than mobile's 20).
    func fetchQueue(limit: Int = 10) async throws -> [KanjiCard] {
        let response: QueueResponse = try await get("/v1/review/queue?limit=\(limit)")
        return response.data
    }

    /// Submit graded results after a session completes.
    func submitResults(_ results: [ReviewResult], studyTimeMs: Int) async throws -> SessionSummary {
        let body = SubmitBody(results: results, studyTimeMs: studyTimeMs)
        let response: SubmitResponse = try await post("/v1/review/submit", body: body)
        return response.data
    }

    /// Fetch SRS status counts — used for complication and HomeView due count.
    func fetchStatus() async throws -> ReviewStatus {
        let response: StatusResponse = try await get("/v1/review/status")
        return response.data
    }

    /// Fetch weekly summary for rest-day encouragement view.
    func fetchWeeklySummary() async throws -> WeeklySummary {
        let response: WeeklySummaryResponse = try await get("/v1/analytics/weekly-summary")
        return response.data
    }
}
