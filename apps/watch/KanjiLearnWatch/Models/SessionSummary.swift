// SessionSummary.swift
// Swift port of SessionSummary from apps/api/src/services/srs.service.ts
// Matches the JSON returned by POST /v1/review/submit

import Foundation

struct SessionSummary: Codable {
    let sessionId: String
    let totalItems: Int
    let correctItems: Int
    let studyTimeMs: Int
    let newLearned: Int
    let burned: Int

    var accuracy: Int {
        guard totalItems > 0 else { return 0 }
        return Int((Double(correctItems) / Double(totalItems)) * 100)
    }

    var wrongItems: Int { totalItems - correctItems }

    var motivationalMessage: String {
        if burned > 0 { return "🔥 \(burned) kanji burned!" }
        if accuracy == 100 { return "Perfect session!" }
        if accuracy >= 90  { return "Outstanding recall!" }
        if accuracy >= 80  { return "Great work — solid retention." }
        if accuracy >= 70  { return "Good session — keep it up." }
        if accuracy >= 60  { return "Decent effort — review the misses." }
        return "Tough session — you'll improve tomorrow."
    }

    var formattedTime: String {
        let totalSecs = studyTimeMs / 1000
        let mins = totalSecs / 60
        let secs = totalSecs % 60
        if mins == 0 { return "\(secs)s" }
        if secs == 0 { return "\(mins)m" }
        return "\(mins)m \(secs)s"
    }
}

// Wrapper matching { ok: true, data: {...} } envelope
struct SubmitResponse: Codable {
    let ok: Bool
    let data: SessionSummary
}

// ─── Review Status (GET /v1/review/status) ────────────────────────────────────

struct ReviewStatus: Codable {
    let unseen: Int
    let learning: Int
    let reviewing: Int
    let remembered: Int
    let burned: Int
    let dueCount: Int
}

struct StatusResponse: Codable {
    let ok: Bool
    let data: ReviewStatus
}

// ─── Weekly Summary (GET /v1/analytics/weekly-summary) ───────────────────────

struct WeeklySummary: Codable {
    let reviewed: Int
    let newLearned: Int
    let burned: Int
    let accuracyPct: Int
    let streakDays: Int

    var encouragementMessage: String {
        if streakDays >= 7 { return "Amazing consistency! \(streakDays)-day streak — you're unstoppable." }
        if streakDays >= 3 { return "Great week! \(streakDays) days of solid practice." }
        if burned > 0      { return "You burned \(burned) kanji this week. Locked in!" }
        return "Solid week — consistency is how mastery happens."
    }
}

struct WeeklySummaryResponse: Codable {
    let ok: Bool
    let data: WeeklySummary
}
