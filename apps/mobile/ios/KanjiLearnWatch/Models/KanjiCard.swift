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

// ── Manual JSON parsing ────────────────────────────────────────────────────────
// watchOS 26.4 beta contains a bug in JSONDecoder that causes an
// EXC_BREAKPOINT (SIGTRAP / brk #1) runtime trap when decoding arrays of
// complex nested structs (confirmed via crash breadcrumb diagnostic in build 96).
// This initializer uses JSONSerialization (ObjC-based, unaffected by the bug)
// to populate KanjiCard without touching JSONDecoder.

extension KanjiCard {
    init?(jsonDict d: [String: Any]) {
        guard
            let kanjiId       = d["kanjiId"]      as? Int,
            let character     = d["character"]    as? String,
            let jlptLevel     = d["jlptLevel"]    as? String,
            let meanings      = d["meanings"]     as? [String],
            let kunReadings   = d["kunReadings"]  as? [String],
            let onReadings    = d["onReadings"]   as? [String],
            let statusStr     = d["status"]       as? String,
            let status        = SrsStatus(rawValue: statusStr),
            let readingStage  = d["readingStage"] as? Int,
            let reviewTypeStr = d["reviewType"]   as? String,
            let reviewType    = ReviewType(rawValue: reviewTypeStr),
            let strokeCount   = d["strokeCount"]  as? Int,
            let radicals      = d["radicals"]     as? [String]
        else { return nil }

        let vocabRaw = d["exampleVocab"] as? [[String: Any]] ?? []
        let exampleVocab: [VocabExample] = vocabRaw.compactMap { item in
            guard let w = item["word"]    as? String,
                  let r = item["reading"] as? String,
                  let m = item["meaning"] as? String
            else { return nil }
            return VocabExample(word: w, reading: r, meaning: m)
        }

        self.kanjiId      = kanjiId
        self.character    = character
        self.jlptLevel    = jlptLevel
        self.meanings     = meanings
        self.kunReadings  = kunReadings
        self.onReadings   = onReadings
        self.exampleVocab = exampleVocab
        self.status       = status
        self.readingStage = readingStage
        self.reviewType   = reviewType
        self.strokeCount  = strokeCount
        self.radicals     = radicals
        // Optional Int fields — NSNumber → Int? coercion
        self.nelsonClassic   = (d["nelsonClassic"]   as? NSNumber).map(\.intValue)
        self.nelsonNew       = (d["nelsonNew"]       as? NSNumber).map(\.intValue)
        self.morohashiIndex  = (d["morohashiIndex"]  as? NSNumber).map(\.intValue)
        self.morohashiVolume = (d["morohashiVolume"] as? NSNumber).map(\.intValue)
        self.morohashiPage   = (d["morohashiPage"]   as? NSNumber).map(\.intValue)
    }
}
