// OnboardingOverlay.swift
// First-launch tutorial explaining the 4 swipe directions.
// Shown as a .sheet from StudyView on the very first card.
// Dismissed by tapping "Got it" — stores a flag in UserDefaults so it
// never appears again.

import SwiftUI
import WatchKit

struct OnboardingOverlay: View {
    let onDismiss: () -> Void

    @State private var currentPage = 0

    private let pages: [OnboardingPage] = [
        OnboardingPage(
            arrow: "←",
            label: "Again",
            description: "Forgot it\nor got it wrong",
            color: .red
        ),
        OnboardingPage(
            arrow: "↓",
            label: "Hard",
            description: "Correct but\ndifficult",
            color: .orange
        ),
        OnboardingPage(
            arrow: "↑",
            label: "Good",
            description: "Correct with\nhesitation",
            color: .blue
        ),
        OnboardingPage(
            arrow: "→",
            label: "Easy",
            description: "Perfect recall",
            color: .green
        ),
    ]

    var body: some View {
        TabView(selection: $currentPage) {
            // Intro page
            VStack(spacing: 6) {
                Text("Swipe to Grade")
                    .font(.system(size: 14, weight: .bold))
                Text("Swipe in 4 directions\nto grade each card")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)

                // Mini diagram showing all 4 directions
                ZStack {
                    DirectionArrow(arrow: "↑", color: .blue,   offset: CGSize(width: 0, height: -22))
                    DirectionArrow(arrow: "↓", color: .orange, offset: CGSize(width: 0, height:  22))
                    DirectionArrow(arrow: "←", color: .red,    offset: CGSize(width: -28, height: 0))
                    DirectionArrow(arrow: "→", color: .green,  offset: CGSize(width:  28, height: 0))
                    Text("漢")
                        .font(.system(size: 18, weight: .light))
                        .foregroundColor(.secondary)
                }
                .frame(height: 60)
            }
            .padding(.horizontal, 6)
            .tag(0)

            // One page per grade
            ForEach(Array(pages.enumerated()), id: \.offset) { i, page in
                OnboardingPageView(page: page)
                    .tag(i + 1)
            }

            // Final page
            VStack(spacing: 8) {
                Text("You're ready!")
                    .font(.system(size: 14, weight: .bold))
                Text("Study a little every day\nto build lasting memory.")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                Button("Got it!", action: gotIt)
                    .buttonStyle(.borderedProminent)
                    .tint(.blue)
            }
            .padding(.horizontal, 6)
            .tag(pages.count + 1)
        }
        .tabViewStyle(.page)
        .indexViewStyle(.page(backgroundDisplayMode: .automatic))
        // Also allow skipping from any page via toolbar button
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Skip", action: gotIt)
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
            }
        }
    }

    private func gotIt() {
        WKInterfaceDevice.current().play(.success)
        onDismiss()
    }
}

// ─── Sub-views ────────────────────────────────────────────────────────────────

private struct OnboardingPage {
    let arrow: String
    let label: String
    let description: String
    let color: Color
}

private struct OnboardingPageView: View {
    let page: OnboardingPage

    var body: some View {
        VStack(spacing: 4) {
            Text(page.arrow)
                .font(.system(size: 32, weight: .black))
                .foregroundColor(page.color)
            Text(page.label)
                .font(.system(size: 15, weight: .bold))
                .foregroundColor(page.color)
            Text(page.description)
                .font(.system(size: 11))
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 6)
    }
}

private struct DirectionArrow: View {
    let arrow: String
    let color: Color
    let offset: CGSize

    var body: some View {
        Text(arrow)
            .font(.system(size: 14, weight: .bold))
            .foregroundColor(color)
            .offset(offset)
    }
}
