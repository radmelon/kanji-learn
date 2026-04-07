// KanjiCard.swift
// Swift port of ReviewQueueItem from apps/api/src/services/srs.service.ts
// Matches the JSON shape returned by GET /v1/review/queue

import Foundation

// Maps to reviewType in ReviewQueueItem
enum ReviewType: String, Codable {
    case meaning  = "meaning"
    case reading  = "reading"
    case writing  = "writing"
    case compound = "compound"
}

// Matches exampleVocab array items
struct VocabExample: Codable {
    let word: String
    let reading: String
    let meaning: String
}

// Full queue item returned by GET /v1/review/queue
struct KanjiCard: Codable, Identifiable {
    let kanjiId: Int
    let character: String
    let jlptLevel: String
    let meanings: [String]
    let kunReadings: [String]
    let onReadings: [String]
    let exampleVocab: [VocabExample]
    let status: SrsStatus
    let readingStage: Int
    let reviewType: ReviewType
    let strokeCount: Int
    let radicals: [String]
    let nelsonClassic: Int?
    let nelsonNew: Int?
    let morohashiIndex: Int?
    let morohashiVolume: Int?
    let morohashiPage: Int?

    // Identifiable conformance — kanjiId is unique per session card
    var id: Int { kanjiId }

    // Watch-optimised accessors (cap at 2 for small screen)
    var watchMeanings: [String] { Array(meanings.prefix(2)) }
    var watchKunReadings: [String] { Array(kunReadings.prefix(2)) }
    var watchOnReadings: [String] { Array(onReadings.prefix(2)) }

    var primaryMeaning: String { meanings.first ?? "" }
}

// Wrapper matching { ok: true, data: [...] } envelope from APIClient
struct QueueResponse: Codable {
    let ok: Bool
    let data: [KanjiCard]
}
