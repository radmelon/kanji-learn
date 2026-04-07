// CardRevealView.swift
// Answer side of a kanji card: meanings, kun readings, on readings.
// Shown after the user taps to reveal; swiping grades the card.
//
// Watch display limits (small screen):
//   - Meanings:     up to 2 (card.watchMeanings)
//   - Kun readings: up to 2 (card.watchKunReadings)
//   - On readings:  up to 2 (card.watchOnReadings)

import SwiftUI

struct CardRevealView: View {
    let card: KanjiCard
    let index: Int
    let total: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // ── Counter bar ───────────────────────────────────────────────────
            HStack {
                StatusBadge(status: card.status)
                Spacer()
                Text("\(index + 1)/\(total)")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.secondary)
            }
            .padding(.horizontal, 8)
            .padding(.top, 6)
            .padding(.bottom, 4)

            Divider()
                .background(Color.white.opacity(0.1))

            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    // ── Meanings ──────────────────────────────────────────────
                    if !card.watchMeanings.isEmpty {
                        ReadingRow(
                            label: nil,
                            values: card.watchMeanings,
                            valueFont: .system(size: 14, weight: .semibold),
                            labelColor: .primary
                        )
                    }

                    // ── Kun readings ──────────────────────────────────────────
                    if !card.watchKunReadings.isEmpty {
                        ReadingRow(
                            label: "kun",
                            values: card.watchKunReadings,
                            valueFont: .system(size: 13, weight: .regular),
                            labelColor: .secondary
                        )
                    }

                    // ── On readings ───────────────────────────────────────────
                    if !card.watchOnReadings.isEmpty {
                        ReadingRow(
                            label: "on",
                            values: card.watchOnReadings,
                            valueFont: .system(size: 13, weight: .regular),
                            labelColor: .secondary
                        )
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
            }

            Divider()
                .background(Color.white.opacity(0.1))

            // ── Swipe hint ────────────────────────────────────────────────────
            HStack(spacing: 10) {
                SwipeHint(symbol: "←", label: "Again", color: .red)
                SwipeHint(symbol: "↓", label: "Hard",  color: .orange)
                SwipeHint(symbol: "↑", label: "Good",  color: .blue)
                SwipeHint(symbol: "→", label: "Easy",  color: .green)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 5)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(white: 0.10))
        .cornerRadius(12)
    }
}

// ─── Sub-views ────────────────────────────────────────────────────────────────

private struct ReadingRow: View {
    let label: String?
    let values: [String]
    let valueFont: Font
    let labelColor: Color

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            if let label {
                Text(label)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(.secondary)
                    .frame(width: 20, alignment: .leading)
            }
            Text(values.joined(separator: "  "))
                .font(valueFont)
                .foregroundColor(labelColor)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
        }
    }
}

private struct SwipeHint: View {
    let symbol: String
    let label: String
    let color: Color

    var body: some View {
        VStack(spacing: 1) {
            Text(symbol)
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(color)
            Text(label)
                .font(.system(size: 8))
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}
