// StudyViewModel.swift
// Session state machine for the Watch study flow.
//
// State transitions:
//   .idle -> loadQueue() -> .loading -> .studying(0, false)
//                                    -> .empty  (no cards due)
//                                    -> .error  (network + no cache)
//   .studying -> revealCard()  -> .studying(index, revealed: true)
//   .studying -> grade(_)      -> .studying(index+1, false)  OR  finishSession()
//   finishSession() -> .loading -> .complete(summary)
//                               -> .error (submit failed; results buffered)

import Foundation
import WatchKit

// ─── Session state ────────────────────────────────────────────────────────────

enum StudyState: Equatable {
    case idle
    case loading
    case studying(index: Int, revealed: Bool)
    case complete(summary: SessionSummary)
    case empty
    case error(message: String)

    static func == (lhs: StudyState, rhs: StudyState) -> Bool {
        switch (lhs, rhs) {
        case (.idle, .idle), (.loading, .loading), (.empty, .empty): return true
        case (.studying(let i1, let r1), .studying(let i2, let r2)): return i1 == i2 && r1 == r2
        case (.complete(let s1), .complete(let s2)):                 return s1.sessionId == s2.sessionId
        case (.error(let m1), .error(let m2)):                       return m1 == m2
        default: return false
        }
    }
}

// ─── UserDefaults keys ────────────────────────────────────────────────────────

private enum CacheKey {
    static let queue           = "kl_cached_queue"
    static let pendingResults  = "kl_pending_results"
    static let pendingTimeMs   = "kl_pending_study_time_ms"
    static let onboardingSeen  = "kl_swipe_onboarding_seen"
}

// ─── StudyViewModel ───────────────────────────────────────────────────────────

// ─── Crash diagnostic keys ───────────────────────────────────────────────────

enum DiagKey {
    static let breadcrumb = "kl_diag_breadcrumb"
    static let rawQueue   = "kl_diag_raw_queue"
}

// ─── StudyViewModel ───────────────────────────────────────────────────────────

@MainActor
final class StudyViewModel: ObservableObject {
    @Published var state: StudyState = .idle
    @Published var queue: [KanjiCard] = []
    @Published var results: [ReviewResult] = []
    @Published var showOnboarding: Bool = false

    /// Set on launch if a crash breadcrumb was found from the previous session.
    /// Displayed in HomeView to help diagnose persistent crashes.
    @Published var crashDiagnostic: String? = nil

    private var sessionStartMs: Int = 0
    private var cardRevealMs: Int = 0

    private let api = APIClient.shared
    private let defaults = UserDefaults.standard

    init() {
        // On launch, check if a crash breadcrumb was written before the previous crash.
        // If present, surface it in HomeView and clear it so it doesn't repeat.
        let ud = UserDefaults.standard
        if let crumb = ud.string(forKey: DiagKey.breadcrumb), !crumb.isEmpty {
            var msg = "⚠ Crash after: \(crumb)"
            if let raw = ud.string(forKey: DiagKey.rawQueue) {
                msg += "\nRaw: \(raw)"
            }
            crashDiagnostic = msg
            ud.removeObject(forKey: DiagKey.breadcrumb)
            ud.removeObject(forKey: DiagKey.rawQueue)
            ud.synchronize()
        }
    }

    // ── Session entry point ────────────────────────────────────────────────────

    func startSession() {
        guard case .idle = state else { return }

        // Set loading state synchronously before spawning the async task so that
        // any re-entrant call (e.g. StudyView's .onAppear idle case) sees .loading
        // and bails out via the guard above.
        state = .loading
        Task { await loadQueue() }
    }

    // ── Load queue ────────────────────────────────────────────────────────────

    private func crumb(_ step: String) {
        defaults.set(step, forKey: DiagKey.breadcrumb)
        defaults.synchronize()
    }

    private func loadQueue() async {
        // state is already .loading (set synchronously by startSession)

        // First, attempt any buffered submission from a previous session
        crumb("retryPendingSubmission_start")
        await retryPendingSubmission()
        crumb("retryPendingSubmission_done")

        do {
            crumb("fetchQueue_start")
            let result = try await api.fetchQueue(limit: 10)
            crumb("fetchQueue_done_count:\(result.cards.count)")
            if result.cards.isEmpty {
                state = .empty
                defaults.removeObject(forKey: DiagKey.breadcrumb)
                defaults.synchronize()
                return
            }
            crumb("assigning_queue")
            queue = result.cards
            crumb("caching_queue_skipped")
            // Queue caching disabled: UserDefaults.set(Data) with the large
            // queue payload also triggers EXC_BREAKPOINT on watchOS 26.4 beta.
            // Offline fallback is acceptable until OS is stable.
            // cacheQueueData(result.rawData)
            crumb("session_start_ms_before")
            sessionStartMs = currentMs()
            crumb("results_clear")
            results = []
            crumb("setting_state_studying")
            state = .studying(index: 0, revealed: false)
            crumb("onboarding_check")
            if !defaults.bool(forKey: CacheKey.onboardingSeen) {
                showOnboarding = true
            }
            // Clear breadcrumb — session started successfully
            defaults.removeObject(forKey: DiagKey.breadcrumb)
            defaults.removeObject(forKey: DiagKey.rawQueue)
            defaults.synchronize()
        } catch {
            // Fall back to cached queue if available
            if let cached = loadCachedQueue(), !cached.isEmpty {
                queue = cached
                sessionStartMs = currentMs()
                results = []
                state = .studying(index: 0, revealed: false)
                if !defaults.bool(forKey: CacheKey.onboardingSeen) {
                    showOnboarding = true
                }
            } else {
                // Expose the real error so it can be reported
                let detail = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                state = .error(message: detail)
            }
        }
    }

    // ── Card actions ──────────────────────────────────────────────────────────

    func revealCard() {
        guard case .studying(let index, false) = state else { return }
        cardRevealMs = currentMs()
        state = .studying(index: index, revealed: true)
    }

    func grade(_ quality: ReviewQuality) {
        guard case .studying(let index, true) = state,
              index < queue.count else { return }

        let card = queue[index]
        let responseTimeMs = currentMs() - cardRevealMs

        let result = ReviewResult(
            kanjiId: card.kanjiId,
            quality: quality.rawValue,
            responseTimeMs: responseTimeMs,
            reviewType: card.reviewType
        )
        results.append(result)

        let nextIndex = index + 1
        if nextIndex >= queue.count {
            Task { await finishSession() }
        } else {
            state = .studying(index: nextIndex, revealed: false)
        }
    }

    // ── Finish session ────────────────────────────────────────────────────────

    private func finishSession() async {
        state = .loading
        let studyTimeMs = currentMs() - sessionStartMs

        do {
            let summary = try await api.submitResults(results, studyTimeMs: studyTimeMs)
            clearPendingSubmission()
            state = .complete(summary: summary)
        } catch {
            // Buffer results for retry on next launch
            bufferPendingSubmission(results: results, studyTimeMs: studyTimeMs)
            // Still show a local summary so the session feels complete
            let detail = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            print("[StudyViewModel] Submit failed (buffered): \(detail)")
            let localSummary = buildLocalSummary(studyTimeMs: studyTimeMs)
            state = .complete(summary: localSummary)
        }
    }

    // ── Reset back to idle ────────────────────────────────────────────────────

    func reset() {
        queue = []
        results = []
        sessionStartMs = 0
        state = .idle
    }

    // ── Onboarding ────────────────────────────────────────────────────────────

    func dismissOnboarding() {
        defaults.set(true, forKey: CacheKey.onboardingSeen)
        showOnboarding = false
    }

    // ── Offline queue cache ───────────────────────────────────────────────────

    /// Store raw server response Data directly — avoids JSONEncoder, which has the
    /// same watchOS 26.4 beta EXC_BREAKPOINT trap as JSONDecoder when handling
    /// complex nested Swift structs.
    private func cacheQueueData(_ data: Data) {
        defaults.set(data, forKey: CacheKey.queue)
    }

    /// Load the cached queue using JSONSerialization + manual KanjiCard init —
    /// avoids JSONDecoder for the same beta-OS reason as cacheQueueData.
    private func loadCachedQueue() -> [KanjiCard]? {
        guard let data = defaults.data(forKey: CacheKey.queue),
              let json  = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let array = json["data"] as? [[String: Any]]
        else { return nil }
        let cards = array.compactMap { KanjiCard(jsonDict: $0) }
        return cards.isEmpty ? nil : cards
    }

    // ── Pending submission buffer ─────────────────────────────────────────────

    private func bufferPendingSubmission(results: [ReviewResult], studyTimeMs: Int) {
        guard let data = try? JSONEncoder().encode(results) else { return }
        defaults.set(data, forKey: CacheKey.pendingResults)
        defaults.set(studyTimeMs, forKey: CacheKey.pendingTimeMs)
    }

    private func clearPendingSubmission() {
        defaults.removeObject(forKey: CacheKey.pendingResults)
        defaults.removeObject(forKey: CacheKey.pendingTimeMs)
    }

    private func retryPendingSubmission() async {
        guard
            let data = defaults.data(forKey: CacheKey.pendingResults),
            let pending = try? JSONDecoder().decode([ReviewResult].self, from: data)
        else { return }

        let studyTimeMs = defaults.integer(forKey: CacheKey.pendingTimeMs)

        do {
            _ = try await api.submitResults(pending, studyTimeMs: studyTimeMs)
            clearPendingSubmission()
        } catch {
            // Leave buffered — will retry again next session start
        }
    }

    // ── Local summary (used when submission fails) ────────────────────────────

    private func buildLocalSummary(studyTimeMs: Int) -> SessionSummary {
        let correct = results.filter { $0.quality >= ReviewQuality.good.rawValue }.count
        return SessionSummary(
            sessionId: UUID().uuidString,
            totalItems: results.count,
            correctItems: correct,
            studyTimeMs: studyTimeMs,
            newLearned: 0,
            burned: 0
        )
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private func currentMs() -> Int {
        // watchOS 26.4 beta may return NaN/infinite from the system clock,
        // causing Int(Double) to trap with EXC_BREAKPOINT. Guard defensively.
        // currentMs() is only used for relative duration (finishSession, grade)
        // so returning 0 produces 0ms durations — acceptable over a crash.
        let t = Date().timeIntervalSince1970 * 1_000
        guard t.isFinite, t > 0, t < Double(Int.max) else { return 0 }
        return Int(t)
    }

    var currentCard: KanjiCard? {
        guard case .studying(let index, _) = state, index < queue.count else { return nil }
        return queue[index]
    }

    var currentIndex: Int {
        guard case .studying(let index, _) = state else { return 0 }
        return index
    }

    var totalCards: Int { queue.count }

    var isRevealed: Bool {
        guard case .studying(_, let revealed) = state else { return false }
        return revealed
    }
}
