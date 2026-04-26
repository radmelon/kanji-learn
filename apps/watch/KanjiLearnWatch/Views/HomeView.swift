// HomeView.swift
// Root screen of the Watch app. Shows the due card count, "Start Study" button,
// and a "Delay" button when cards are due. Navigates to StudyView on tap.
//
// Fetches ReviewStatus on appear and whenever the app becomes active.
// Respects the delay timestamp set by NotificationService.

import SwiftUI
import WatchKit
import os

// watchOS suppresses print() in release/TestFlight builds, so [KL-Watch] lines
// went missing from Console.app. Logger over Apple's unified logging system is
// reliably captured. The .public privacy annotation keeps interpolated payloads
// readable so the existing log filter still surfaces every value during testing.
//
// Use .notice (not .info): unified logging persists notice+ to disk and
// surfaces them in Console.app without any user toggle, while .info is
// memory-only by default and requires "Action → Include Info Messages."
// We want testing-phase logs visible by default.
private let klWatchLogger = Logger(subsystem: "com.rdennis.kanjilearn2.watchkitapp", category: "kl-watch")
private func klWatchLog(_ msg: String) { klWatchLogger.notice("\(msg, privacy: .public)") }

struct HomeView: View {
    @EnvironmentObject var viewModel: StudyViewModel
    @EnvironmentObject var watchSession: WatchSessionManager

    @State private var status: ReviewStatus? = nil
    @State private var isLoadingStatus = true
    @State private var showStudy = false
    @State private var showDelay = false
    @State private var isDelayed = NotificationService.shared.isDelayed
    @State private var delayUntil: Date? = NotificationService.shared.delayUntil
    @State private var lastStatusError: String? = nil

    private let api = APIClient.shared

    /// Daily goal from the iPhone app (synced via WatchConnectivity), defaulting to 20.
    private var dailyGoal: Int {
        let v = UserDefaults.standard.integer(forKey: "kl_daily_goal")
        return v > 0 ? v : 20
    }

    /// Cap the due count at the daily goal — the server backlog can be thousands
    /// of overdue cards, but the user only needs to see how many they'll actually
    /// do today (one session = up to dailyGoal cards).
    private var cappedDueCount: Int { min(status?.dueCount ?? 0, dailyGoal) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    // ── Connection warning ────────────────────────────────────
                    if !watchSession.isAuthenticated {
                        NotAuthenticatedBanner()
                    }

                    // ── Sync error banner (dismissable) ───────────────────────
                    if let err = lastStatusError {
                        StatusErrorBanner(message: err) {
                            lastStatusError = nil
                        }
                    }

                    // ── Due count hero ────────────────────────────────────────
                    DueCountHero(
                        dueCount: cappedDueCount,
                        dailyGoal: dailyGoal,
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
                    let dueCount = cappedDueCount
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
            let ts = Int64(Date().timeIntervalSince1970 * 1000)
            klWatchLog("[KL-Watch] \(ts) refreshStatus skip=not-authenticated")
            isLoadingStatus = false
            return
        }
        isLoadingStatus = true
        defer { isLoadingStatus = false }

        let ts = Int64(Date().timeIntervalSince1970 * 1000)
        do {
            status = try await api.fetchStatus()
            lastStatusError = nil
            klWatchLog("[KL-Watch] \(ts) refreshStatus result=ok dueCount=\(status?.dueCount ?? -1)")
        } catch {
            let detail = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            lastStatusError = detail
            klWatchLog("[KL-Watch] \(ts) refreshStatus result=error detail=\(detail)")
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

private struct StatusErrorBanner: View {
    let message: String
    let onDismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 13))
                .foregroundColor(.orange)
            VStack(alignment: .leading, spacing: 2) {
                Text("Sync error")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.primary)
                Text(message)
                    .font(.system(size: 10))
                    .foregroundColor(.primary)
                    .lineLimit(4)
            }
            Spacer(minLength: 4)
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss error")
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.15))
        .cornerRadius(8)
    }
}

private struct DueCountHero: View {
    let dueCount: Int
    let dailyGoal: Int
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
            Text(subtitle)
                .font(.system(size: 12))
                .foregroundColor(.secondary)
        }
    }

    private var subtitle: String {
        if dueCount == 0 { return "All caught up" }
        return "of \(dailyGoal) today"
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
            MiniPill(count: status.learning,   label: "learn",  color: Color(hex: "#3B82F6"))
            MiniPill(count: status.reviewing,  label: "review", color: Color(hex: "#F59E0B"))
            MiniPill(count: status.burned,     label: "burned", color: Color(hex: "#EF4444"))
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
