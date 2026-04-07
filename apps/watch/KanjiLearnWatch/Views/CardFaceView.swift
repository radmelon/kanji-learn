// CardFaceView.swift
// Question side of a kanji card: large character, SRS status badge, card counter.
// Tapping reveals the answer (calls viewModel.revealCard()).

import SwiftUI

struct CardFaceView: View {
    let card: KanjiCard
    let index: Int
    let total: Int
    let onTap: () -> Void

    var body: some View {
        VStack(spacing: 0) {
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

            Spacer()

            // ── Kanji character ───────────────────────────────────────────────
            Text(card.character)
                .font(.system(size: 52, weight: .regular, design: .default))
                .minimumScaleFactor(0.6)
                .lineLimit(1)
                .foregroundColor(.primary)

            Spacer()

            // ── Tap hint ──────────────────────────────────────────────────────
            Text("Tap to reveal")
                .font(.system(size: 11))
                .foregroundColor(.secondary)
                .padding(.bottom, 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(white: 0.12))
        .cornerRadius(12)
        .contentShape(Rectangle())
        .onTapGesture(perform: onTap)
    }
}

// ─── SRS status badge ─────────────────────────────────────────────────────────

struct StatusBadge: View {
    let status: SrsStatus

    var body: some View {
        Text(status.displayLabel)
            .font(.system(size: 10, weight: .semibold))
            .foregroundColor(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color(hex: status.displayColor))
            .cornerRadius(4)
    }
}
