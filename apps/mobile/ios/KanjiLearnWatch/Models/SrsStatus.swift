// SrsStatus.swift
// Swift port of SrsStatus from packages/shared/src/types.ts

import Foundation

enum SrsStatus: String, Codable, CaseIterable {
    case unseen     = "unseen"
    case learning   = "learning"
    case reviewing  = "reviewing"
    case remembered = "remembered"
    case burned     = "burned"

    var displayColor: String {
        switch self {
        case .unseen:     return "#6B7280"  // gray      — matches mobile colors.unseen
        case .learning:   return "#3B82F6"  // blue      — matches mobile colors.learning
        case .reviewing:  return "#F59E0B"  // amber     — matches mobile colors.reviewing
        case .remembered: return "#10B981"  // emerald   — matches mobile colors.remembered
        case .burned:     return "#EF4444"  // red       — matches mobile colors.burned
        }
    }

    var displayLabel: String {
        switch self {
        case .unseen:     return "New"
        case .learning:   return "Learning"
        case .reviewing:  return "Reviewing"
        case .remembered: return "Remembered"
        case .burned:     return "Burned"
        }
    }
}
