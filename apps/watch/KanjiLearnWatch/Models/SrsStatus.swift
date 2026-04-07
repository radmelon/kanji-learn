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
        case .unseen:     return "#8E8E93"  // gray
        case .learning:   return "#007AFF"  // blue
        case .reviewing:  return "#AF52DE"  // purple
        case .remembered: return "#34C759"  // green
        case .burned:     return "#FF9500"  // gold/orange
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
