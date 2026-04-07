// SessionCompleteView.swift
// Post-session summary shown after all cards are graded.
// Motivational message logic ported from:
//   apps/mobile/src/components/study/SessionComplete.tsx (lines 24-33)

import SwiftUI
import WatchKit

struct SessionCompleteView: View {
    let summary: SessionSummary
    let onDone: () -> Void

    @State private var appeared = false

    private var accuracyColor: Color {
        if summary.accuracy >= 80 { return .green }
        if summary.accuracy >= 60 { return .yellow }
        return .red
    }

    private var heroIcon: String {
        if summary.accuracy >= 80 { return "checkmark.circle.fill" }
        if summary.accuracy >= 60 { return "star.fill" }
        return "arrow.clockwise.circle.fill"
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                // ── Hero ──────────────────────────────────────────────────────
                VStack(spacing: 4) {
                    Image(systemName: heroIcon)
                        .font(.system(size: 28))
                        .foregroundColor(accuracyColor)
                        .scaleEffect(appeared ? 1.0 : 0.4)
                        .animation(.spring(response: 0.45, dampingFraction: 0.6), value: appeared)

                    Text("Session Complete")
                        .font(.system(size: 14, weight: .bold))

                    Text(summary.motivationalMessage)
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.top, 4)

                // ── Accuracy ──────────────────────────────────────────────────
                VStack(spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 2) {
                        Text("\(summary.accuracy)")
                            .font(.system(size: 32, weight: .bold, design: .rounded))
                            .foregroundColor(accuracyColor)
                        Text("%")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(accuracyColor)
                    }

                    // Accuracy bar
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 3)
                                .fill(Color.white.opacity(0.12))
                                .frame(height: 5)
                            RoundedRectangle(cornerRadius: 3)
                                .fill(accuracyColor)
                                .frame(
                                    width: appeared
                                        ? geo.size.width * CGFloat(summary.accuracy) / 100
                                        : 0,
                                    height: 5
                                )
                                .animation(.easeOut(duration: 0.6).delay(0.3), value: appeared)
                        }
                    }
                    .frame(height: 5)
                }
                .padding(.horizontal, 2)

                // ── Stats row ─────────────────────────────────────────────────
                HStack(spacing: 6) {
                    StatChip(
                        value: "\(summary.correctItems)",
                        label: "correct",
                        color: .green
                    )
                    StatChip(
                        value: "\(summary.wrongItems)",
                        label: "wrong",
                        color: summary.wrongItems > 0 ? .red : .secondary
                    )
                    StatChip(
                        value: summary.formattedTime,
                        label: "time",
                        color: .blue
                    )
                }

                // ── Burned / new learned ──────────────────────────────────────
                if summary.burned > 0 || summary.newLearned > 0 {
                    HStack(spacing: 6) {
                        if summary.newLearned > 0 {
                            StatChip(
                                value: "\(summary.newLearned)",
                                label: "new",
                                color: .purple
                            )
                        }
                        if summary.burned > 0 {
                            StatChip(
                                value: "\(summary.burned)",
                                label: "🔥 burned",
                                color: .orange
                            )
                        }
                    }
                }

                // ── Done button ───────────────────────────────────────────────
                Button("Done", action: onDone)
                    .buttonStyle(.borderedProminent)
                    .tint(.blue)
                    .frame(maxWidth: .infinity)
            }
            .padding(.horizontal, 6)
            .padding(.bottom, 10)
        }
        .onAppear {
            appeared = true
            // Celebratory haptic
            let haptic: WKHapticType = summary.accuracy >= 80 ? .success : .notification
            WKInterfaceDevice.current().play(haptic)
        }
    }
}

// ─── Stat chip ────────────────────────────────────────────────────────────────

private struct StatChip: View {
    let value: String
    let label: String
    let color: Color

    var body: some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .foregroundColor(color)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(label)
                .font(.system(size: 9))
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .background(color.opacity(0.1))
        .cornerRadius(6)
    }
}
