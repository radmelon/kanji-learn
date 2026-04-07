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

@MainActor
final class StudyViewModel: ObservableObject {
    @Published var state: StudyState = .idle
    @Published var queue: [KanjiCard] = []
    @Published var results: [ReviewResult] = []
    @Published var showOnboarding: Bool = false

    private var sessionStartMs: Int = 0
    private var cardRevealMs: Int = 0

    private let api = APIClient.shared
    private let defaults = UserDefaults.standard

    // ── Session entry point ────────────────────────────────────────────────────

    func startSession() {
        guard case .idle = state, state != .loading else { return }

        // Show onboarding overlay on first ever launch
        if !defaults.bool(forKey: CacheKey.onboardingSeen) {
            showOnboarding = true
        }

        Task { await loadQueue() }
    }

    // ── Load queue ────────────────────────────────────────────────────────────

    private func loadQueue() async {
        state = .loading

        // First, attempt any buffered submission from a previous session
        await retryPendingSubmission()

        do {
            let cards = try await api.fetchQueue(limit: 10)
            if cards.isEmpty {
                state = .empty
                return
            }
            queue = cards
            cacheQueue(cards)
            sessionStartMs = currentMs()
            results = []
            state = .studying(index: 0, revealed: false)
        } catch {
            // Fall back to cached queue if available
            if let cached = loadCachedQueue(), !cached.isEmpty {
                queue = cached
                sessionStartMs = currentMs()
                results = []
                state = .studying(index: 0, revealed: false)
            } else {
                state = .error(message: "Couldn't load cards. Check your connection.")
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

    private func cacheQueue(_ cards: [KanjiCard]) {
        guard let data = try? JSONEncoder().encode(cards) else { return }
        defaults.set(data, forKey: CacheKey.queue)
    }

    private func loadCachedQueue() -> [KanjiCard]? {
        guard let data = defaults.data(forKey: CacheKey.queue),
              let cards = try? JSONDecoder().decode([KanjiCard].self, from: data) else { return nil }
        return cards
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

    private func currentMs() -> Int { Int(Date().timeIntervalSince1970 * 1000) }

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
