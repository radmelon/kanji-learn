// StudyView.swift
// The active study session screen. Orchestrates the state machine from
// StudyViewModel and composes CardFaceView / CardRevealView inside
// SwipeableCardView.
//
// Rendered by HomeView when the user taps "Start Study".

import SwiftUI

struct StudyView: View {
    @EnvironmentObject var viewModel: StudyViewModel
    @Environment(\.dismiss) var dismiss

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            switch viewModel.state {
            case .idle:
                // Shouldn't normally be visible — HomeView triggers startSession()
                Color.clear.onAppear { viewModel.startSession() }

            case .loading:
                ProgressView()
                    .progressViewStyle(.circular)

            case .studying(let index, let revealed):
                studyingBody(index: index, revealed: revealed)

            case .complete(let summary):
                SessionCompleteView(summary: summary) {
                    viewModel.reset()
                    dismiss()
                }

            case .empty:
                EmptyQueueView { dismiss() }

            case .error(let message):
                ErrorView(message: message) {
                    viewModel.startSession()
                } onDismiss: {
                    viewModel.reset()
                    dismiss()
                }
            }
        }
        // Show onboarding overlay on first launch, over the card
        .sheet(isPresented: $viewModel.showOnboarding) {
            OnboardingOverlay { viewModel.dismissOnboarding() }
        }
    }

    // ── Active card view ──────────────────────────────────────────────────────

    @ViewBuilder
    private func studyingBody(index: Int, revealed: Bool) -> some View {
        guard let card = viewModel.currentCard else {
            Color.clear
            return
        }

        SwipeableCardView(isRevealed: revealed) { quality in
            viewModel.grade(quality)
        } content: {
            if revealed {
                CardRevealView(
                    card: card,
                    index: index,
                    total: viewModel.totalCards
                )
            } else {
                CardFaceView(
                    card: card,
                    index: index,
                    total: viewModel.totalCards
                ) {
                    viewModel.revealCard()
                }
            }
        }
        .padding(4)
        // Progress bar at the very top
        .overlay(alignment: .top) {
            ProgressBar(current: index, total: viewModel.totalCards)
                .padding(.horizontal, 4)
        }
        .animation(.easeInOut(duration: 0.15), value: revealed)
    }
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

private struct ProgressBar: View {
    let current: Int
    let total: Int

    var progress: Double {
        guard total > 0 else { return 0 }
        return Double(current) / Double(total)
    }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color.white.opacity(0.15))
                    .frame(height: 3)
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color.blue)
                    .frame(width: geo.size.width * progress, height: 3)
                    .animation(.easeInOut(duration: 0.2), value: progress)
            }
        }
        .frame(height: 3)
    }
}

// ─── Empty queue ──────────────────────────────────────────────────────────────

private struct EmptyQueueView: View {
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            Text("✓")
                .font(.system(size: 32))
            Text("All caught up!")
                .font(.system(size: 15, weight: .semibold))
            Text("No cards due right now.")
                .font(.system(size: 12))
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
            Button("Done", action: onDone)
                .buttonStyle(.borderedProminent)
        }
        .padding()
    }
}

// ─── Error view ───────────────────────────────────────────────────────────────

private struct ErrorView: View {
    let message: String
    let onRetry: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            Text("⚠️")
                .font(.system(size: 28))
            Text(message)
                .font(.system(size: 12))
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
            HStack(spacing: 8) {
                Button("Retry", action: onRetry)
                    .buttonStyle(.borderedProminent)
                Button("Cancel", action: onDismiss)
                    .buttonStyle(.bordered)
            }
        }
        .padding()
    }
}
