// DelayPickerView.swift
// Shown when user taps "Delay" on HomeView.
//
// Layout:
//   1. Context-aware encouragement message (priority order per spec)
//   2. Prominent "Study Now" primary button
//   3. Delay time options (1h, 2h, 4h, Tonight, Tomorrow)
//
// Encouragement priority (first matching condition wins):
//   1. Daily goal met by due count
//   2. Study mate competition (mates ahead / user leading)
//   3. Streak preservation
//   4. SRS urgency fallback

import SwiftUI
import WatchKit

struct DelayPickerView: View {
    let dueCount: Int
    let onDelaySelected: () -> Void
    let onStudyNow: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var mateStatus: MateStatus = .loading
    @State private var streak: Int = 0

    // Cached profile values set by WatchSessionManager
    private var dailyGoal: Int { UserDefaults.standard.integer(forKey: "kl_daily_goal").nonZero ?? 20 }

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                // ── Encouragement ─────────────────────────────────────────────
                EncouragementCard(message: encouragement)

                // ── Study Now (primary) ───────────────────────────────────────
                Button {
                    WKInterfaceDevice.current().play(.click)
                    dismiss()
                    onStudyNow()
                } label: {
                    Label("Study Now", systemImage: "brain.head.profile")
                        .frame(maxWidth: .infinity)
                        .font(.system(size: 13, weight: .semibold))
                }
                .buttonStyle(.borderedProminent)
                .tint(.blue)

                // ── Divider ───────────────────────────────────────────────────
                HStack {
                    Rectangle().fill(Color.white.opacity(0.15)).frame(height: 0.5)
                    Text("or delay")
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                        .fixedSize()
                    Rectangle().fill(Color.white.opacity(0.15)).frame(height: 0.5)
                }

                // ── Delay options ─────────────────────────────────────────────
                VStack(spacing: 6) {
                    ForEach(DelayOption.allCases) { option in
                        Button {
                            scheduleDelay(option)
                        } label: {
                            HStack {
                                Image(systemName: "clock.arrow.circlepath")
                                    .font(.system(size: 11))
                                    .foregroundColor(.secondary)
                                Text(option.displayTitle)
                                    .font(.system(size: 12))
                                Spacer()
                                Text(option.fireDate(), style: .time)
                                    .font(.system(size: 10))
                                    .foregroundColor(.secondary)
                            }
                        }
                        .buttonStyle(.bordered)
                        .foregroundColor(.primary)
                    }
                }
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 8)
        }
        .task { await loadContext() }
    }

    // ── Encouragement text ────────────────────────────────────────────────────

    private var encouragement: String {
        // 1. Daily goal
        if dueCount >= dailyGoal {
            return "You have \(dueCount) cards waiting — that's your full daily goal! A quick session keeps your streak alive."
        }

        // 2. Study mates
        switch mateStatus {
        case .someAhead(let n):
            return "\(n) study mate\(n > 1 ? "s" : "") already studied today. Don't let them pull ahead!"
        case .userLeading:
            return "You're leading your study mates today — keep the edge!"
        default:
            break
        }

        // 3. Streak
        if streak > 0 {
            return "You're on a \(streak)-day streak! Don't break the chain."
        }

        // 4. Fallback
        return "Regular practice is the key to retention. Delayed cards pile up and become harder tomorrow."
    }

    // ── Load context (mates + streak from API / cache) ────────────────────────

    private func loadContext() async {
        // Read streak from cached status (available from HomeView's fetchStatus call)
        // Streak is not in ReviewStatus, so default to UserDefaults if previously stored
        streak = UserDefaults.standard.integer(forKey: "kl_cached_streak")

        do {
            let status = try await APIClient.shared.fetchStatus()
            let friends = try await APIClient.shared.fetchFriendsActivity()

            let myReviewed = status.todayReviewed ?? 0
            let aheadCount = friends.filter { $0.todayReviewed > myReviewed }.count

            if aheadCount > 0 {
                mateStatus = .someAhead(aheadCount)
            } else if !friends.isEmpty {
                mateStatus = .userLeading
            } else {
                mateStatus = .noMates
            }
        } catch {
            mateStatus = .noMates
        }
    }

    // ── Schedule delay ────────────────────────────────────────────────────────

    private func scheduleDelay(_ option: DelayOption) {
        WKInterfaceDevice.current().play(.notification)
        NotificationService.shared.scheduleDelay(option, dueCount: dueCount)
        dismiss()
        onDelaySelected()
    }
}

// ─── Mate status ──────────────────────────────────────────────────────────────

private enum MateStatus {
    case loading
    case someAhead(Int)
    case userLeading
    case noMates
}

// ─── Encouragement card ───────────────────────────────────────────────────────

private struct EncouragementCard: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: "flame.fill")
                .font(.system(size: 13))
                .foregroundColor(.orange)
                .padding(.top, 1)
            Text(message)
                .font(.system(size: 11))
                .foregroundColor(.primary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(8)
        .background(Color.orange.opacity(0.1))
        .cornerRadius(8)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.orange.opacity(0.25), lineWidth: 0.5)
        )
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

private extension Int {
    var nonZero: Int? { self == 0 ? nil : self }
}
