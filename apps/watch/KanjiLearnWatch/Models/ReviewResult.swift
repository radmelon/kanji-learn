// ReviewResult.swift
// Swift port of ReviewResult from packages/shared/src/types.ts
// Matches the JSON sent to POST /v1/review/submit

import Foundation

// SM-2 quality rating (0-5). Watch uses a simplified 4-grade system:
// Again=1, Hard=3, Good=4, Easy=5
enum ReviewQuality: Int, Codable {
    case blackout  = 0  // complete blackout (not used by Watch)
    case again     = 1  // incorrect, reset
    case incorrect = 2  // incorrect but remembered (not used by Watch)
    case hard      = 3  // correct with significant difficulty
    case good      = 4  // correct after hesitation
    case easy      = 5  // perfect recall

    var isCorrect: Bool { rawValue >= 4 }

    var swipeLabel: String {
        switch self {
        case .again:     return "✗ AGAIN"
        case .hard:      return "⚠ HARD"
        case .good:      return "✓ GOOD"
        case .easy:      return "✓ EASY"
        default:         return ""
        }
    }

    var swipeColorHex: String {
        switch self {
        case .again:     return "#FF3B30"  // red
        case .hard:      return "#FF9500"  // orange
        case .good:      return "#007AFF"  // blue
        case .easy:      return "#34C759"  // green
        default:         return "#8E8E93"
        }
    }
}

struct ReviewResult: Codable {
    let kanjiId: Int
    let quality: Int          // raw Int so Codable matches API schema exactly
    let responseTimeMs: Int
    let reviewType: ReviewType
}

// Body sent to POST /v1/review/submit
struct SubmitBody: Codable {
    let results: [ReviewResult]
    let studyTimeMs: Int
}
