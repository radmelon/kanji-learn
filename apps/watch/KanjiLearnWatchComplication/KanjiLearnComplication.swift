// KanjiLearnComplication.swift
// WidgetKit complication extension that shows the user's due kanji count on
// their watch face.
//
// ── Xcode setup required ──────────────────────────────────────────────────────
// This file lives in a separate "Widget Extension" target:
//   File > New > Target > Widget Extension → "KanjiLearnWatchComplication"
//   Deployment target: watchOS 10.0+
//
// App Group (shared UserDefaults between Watch app + this extension):
//   Signing & Capabilities → Add "App Groups" → group.com.kanji-learn.watch
//   Add the SAME App Group to the KanjiLearnWatch target.
//
// The Watch app writes the due count via BackgroundRefreshHandler:
//   UserDefaults(suiteName: "group.com.kanji-learn.watch")?.set(dueCount, forKey: "kl_due_count")
//   WidgetCenter.shared.reloadAllTimelines()
// ─────────────────────────────────────────────────────────────────────────────

import WidgetKit
import SwiftUI

private let appGroupID = "group.com.kanji-learn.watch"
private let dueCountKey = "kl_due_count"

// ─── Timeline entry ───────────────────────────────────────────────────────────

struct DueCountEntry: TimelineEntry {
    let date: Date
    let dueCount: Int
}

// ─── Provider ─────────────────────────────────────────────────────────────────

struct DueCountProvider: TimelineProvider {

    private func readDueCount() -> Int {
        UserDefaults(suiteName: appGroupID)?.integer(forKey: dueCountKey) ?? 0
    }

    func placeholder(in context: Context) -> DueCountEntry {
        DueCountEntry(date: .now, dueCount: 5)
    }

    func getSnapshot(in context: Context, completion: @escaping (DueCountEntry) -> Void) {
        completion(DueCountEntry(date: .now, dueCount: readDueCount()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DueCountEntry>) -> Void) {
        let entry = DueCountEntry(date: .now, dueCount: readDueCount())
        // Refresh every 30 minutes as a backstop; the Watch app calls
        // WidgetCenter.shared.reloadAllTimelines() after each background fetch.
        let nextUpdate = Calendar.current.date(byAdding: .minute, value: 30, to: .now)
            ?? .now.addingTimeInterval(1800)
        completion(Timeline(entries: [entry], policy: .after(nextUpdate)))
    }
}

// ─── Views ────────────────────────────────────────────────────────────────────

struct KanjiLearnComplicationView: View {
    var entry: DueCountEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        switch family {
        case .accessoryCircular:
            circularView
        case .accessoryCorner:
            cornerView
        case .accessoryRectangular:
            rectangularView
        default:
            Text("\(entry.dueCount)")
        }
    }

    // ── Circular (most common on Watch face) ──────────────────────────────────

    private var circularView: some View {
        ZStack {
            Circle().fill(Color.orange.opacity(0.15))
            VStack(spacing: 0) {
                Image(systemName: "text.book.closed")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.orange)
                Text("\(entry.dueCount)")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .contentTransition(.numericText())
                    .foregroundColor(.primary)
            }
        }
    }

    // ── Corner ────────────────────────────────────────────────────────────────

    private var cornerView: some View {
        Label {
            Text("\(entry.dueCount)")
                .font(.system(.body, design: .rounded))
        } icon: {
            Image(systemName: "text.book.closed")
                .foregroundColor(.orange)
        }
        .widgetLabel { Text("Due") }
    }

    // ── Rectangular ───────────────────────────────────────────────────────────

    private var rectangularView: some View {
        HStack(spacing: 8) {
            Image(systemName: "text.book.closed")
                .font(.system(size: 15))
                .foregroundColor(.orange)
            VStack(alignment: .leading, spacing: 1) {
                Text("\(entry.dueCount) kanji due")
                    .font(.system(size: 13, weight: .semibold))
                    .contentTransition(.numericText())
                Text("Tap to study")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
            }
            Spacer()
        }
    }
}

// ─── Widget definition ────────────────────────────────────────────────────────

struct KanjiLearnDueCountWidget: Widget {
    let kind = "KanjiLearnDueCount"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: DueCountProvider()) { entry in
            KanjiLearnComplicationView(entry: entry)
        }
        .configurationDisplayName("Kanji Due")
        .description("Shows how many kanji are ready for review.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryRectangular])
    }
}

// ─── Bundle entry point ───────────────────────────────────────────────────────

@main
struct KanjiLearnComplicationBundle: WidgetBundle {
    var body: some Widget {
        KanjiLearnDueCountWidget()
    }
}
