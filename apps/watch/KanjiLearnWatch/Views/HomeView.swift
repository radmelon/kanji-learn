// HomeView.swift
// Root screen of the Watch app. Shows the due card count, "Start Study" button,
// and a "Delay" button when cards are due. Navigates to StudyView on tap.
//
// Fetches ReviewStatus on appear and whenever the app becomes active.
// Respects the delay timestamp set by NotificationService.

import SwiftUI
import WatchKit

struct HomeView: View {
    @EnvironmentObject var viewModel: StudyViewModel
    @EnvironmentObject var watchSession: WatchSessionManager

    @State private var status: ReviewStatus? = nil
    @State private var isLoadingStatus = true
    @State private var showStudy = false
    @State private var showDelay = false
    @State private var isDelayed = NotificationService.shared.isDelayed
    @State private var delayUntil: Date? = NotificationService.shared.delayUntil

    private let api = APIClient.shared

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    // ── Connection warning ────────────────────────────────────
                    if !watchSession.isAuthenticated {
                        NotAuthenticatedBanner()
                    }

                    // ── Due count hero ────────────────────────────────────────
                    DueCountHero(
                        dueCount: status?.dueCount ?? 0,
                        isLoading: isLoadingStatus
                    )

                    // ── Delay banner (if session snoozed) ─────────────────────
                    if isDelayed, let until = delayUntil {
                        DelayBanner(until: until) {
                            NotificationService.shared.cancelDelay()
                            isDelayed = false
                            delayUntil = nil
                        }
                    }

                    // ── Primary action ────────────────────────────────────────
                    let dueCount = status?.dueCount ?? 0
                    let canStudy = dueCount > 0 && watchSession.isAuthenticated

                    Button {
                        viewModel.startSession()
                        showStudy = true
                    } label: {
                        Label(
                            isDelayed ? "Study Anyway" : "Start Study",
                            systemImage: "brain.head.profile"
                        )
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!canStudy)
                    .tint(isDelayed ? .orange : .blue)

                    // ── Delay button (only when cards due and not already delayed)
                    if canStudy && !isDelayed {
                        Button {
                            showDelay = true
                        } label: {
                            Label("Delay", systemImage: "clock.arrow.circlepath")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .foregroundColor(.secondary)
                    }

                    // ── SRS status pills ──────────────────────────────────────
                    if let status {
                        StatusPills(status: status)
                    }
                }
                .padding(.horizontal, 4)
                .padding(.vertical, 8)
            }
            .navigationTitle("漢字")
            .navigationBarTitleDisplayMode(.inline)
        }
        .fullScreenCover(isPresented: $showStudy, onDismiss: {
            viewModel.reset()
            Task { await refreshStatus() }
        }) {
            StudyView()
                .environmentObject(viewModel)
        }
        .sheet(isPresented: $showDelay) {
            DelayPickerView(dueCount: status?.dueCount ?? 0) {
                // On delay selected
                isDelayed = NotificationService.shared.isDelayed
                delayUntil = NotificationService.shared.delayUntil
            } onStudyNow: {
                showDelay = false
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    viewModel.startSession()
                    showStudy = true
                }
            }
        }
        .task { await refreshStatus() }
        .onReceive(NotificationCenter.default.publisher(for: WKExtension.applicationDidBecomeActiveNotification)) { _ in
            Task { await refreshStatus() }
            isDelayed = NotificationService.shared.isDelayed
            delayUntil = NotificationService.shared.delayUntil
        }
    }

    // ── Refresh status from API ────────────────────────────────────────────────

    private func refreshStatus() async {
        guard watchSession.isAuthenticated else {
            isLoadingStatus = false
            return
        }
        isLoadingStatus = true
        defer { isLoadingStatus = false }

        do {
            status = try await api.fetchStatus()
        } catch {
            // Keep stale status — HomeView still usable
        }
    }
}

// ─── Sub-views ────────────────────────────────────────────────────────────────

private struct NotAuthenticatedBanner: View {
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "iphone.and.arrow.forward")
                .font(.system(size: 13))
                .foregroundColor(.orange)
            Text("Open iPhone app to connect")
                .font(.system(size: 11))
                .foregroundColor(.secondary)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.12))
        .cornerRadius(8)
    }
}

private struct DueCountHero: View {
    let dueCount: Int
    let isLoading: Bool

    var body: some View {
        VStack(spacing: 2) {
            if isLoading {
                ProgressView()
                    .frame(height: 36)
            } else {
                Text("\(dueCount)")
                    .font(.system(size: 36, weight: .bold, design: .rounded))
                    .foregroundColor(dueCount > 0 ? .blue : .secondary)
                    .contentTransition(.numericText())
                    .animation(.easeInOut, value: dueCount)
            }
            Text(dueCount == 1 ? "review due" : "reviews due")
                .font(.system(size: 12))
                .foregroundColor(.secondary)
        }
    }
}

private struct DelayBanner: View {
    let until: Date
    let onCancel: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "clock.fill")
                .font(.system(size: 11))
                .foregroundColor(.orange)
            VStack(alignment: .leading, spacing: 1) {
                Text("Snoozed until")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                Text(until, style: .time)
                    .font(.system(size: 11, weight: .medium))
            }
            Spacer()
            Button("Cancel", action: onCancel)
                .font(.system(size: 10))
                .buttonStyle(.bordered)
                .controlSize(.mini)
        }
        .padding(8)
        .background(Color.orange.opacity(0.12))
        .cornerRadius(8)
    }
}

private struct StatusPills: View {
    let status: ReviewStatus

    var body: some View {
        HStack(spacing: 6) {
            MiniPill(count: status.learning,   label: "learn", color: .blue)
            MiniPill(count: status.reviewing,  label: "review", color: .purple)
            MiniPill(count: status.burned,     label: "burned", color: .orange)
        }
    }
}

private struct MiniPill: View {
    let count: Int
    let label: String
    let color: Color

    var body: some View {
        VStack(spacing: 1) {
            Text("\(count)")
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundColor(color)
            Text(label)
                .font(.system(size: 9))
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 5)
        .background(color.opacity(0.1))
        .cornerRadius(6)
    }
}
