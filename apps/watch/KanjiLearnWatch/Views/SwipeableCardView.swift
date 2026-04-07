// SwipeableCardView.swift
// Wraps any card content in a 4-directional swipe gesture.
//
// Swipe mapping (threshold: 50pt):
//   ← Left  → Again (quality 1) — red
//   ↓ Down  → Hard  (quality 3) — orange
//   ↑ Up    → Good  (quality 4) — blue
//   → Right → Easy  (quality 5) — green
//
// Axis lock: once the dominant axis is determined (after 10pt of movement),
// the card is constrained to that axis so diagonal swipes don't misfire.
//
// Haptics: .click at threshold crossing, grade-appropriate feedback on commit.

import SwiftUI
import WatchKit

// ─── Grade badge ──────────────────────────────────────────────────────────────

private struct GradeBadge: View {
    let quality: ReviewQuality
    let opacity: Double

    var body: some View {
        Text(quality.swipeLabel)
            .font(.system(size: 13, weight: .black))
            .foregroundColor(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color(hex: quality.swipeColorHex))
            .cornerRadius(6)
            .opacity(opacity)
            .animation(.easeIn(duration: 0.1), value: opacity)
    }
}

// ─── SwipeableCardView ────────────────────────────────────────────────────────

struct SwipeableCardView<Content: View>: View {
    let content: Content
    let isRevealed: Bool
    let onGrade: (ReviewQuality) -> Void

    init(isRevealed: Bool, onGrade: @escaping (ReviewQuality) -> Void, @ViewBuilder content: () -> Content) {
        self.isRevealed = isRevealed
        self.onGrade = onGrade
        self.content = content()
    }

    // ── Gesture state ─────────────────────────────────────────────────────────

    @State private var offset: CGSize = .zero
    @State private var lockedAxis: Axis? = nil      // nil = not yet locked
    @State private var didFireHaptic = false
    @State private var isFlying = false             // true while fly-off animation runs
    @State private var flyOffset: CGSize = .zero

    private let lockThreshold: CGFloat = 10     // pt before axis is locked
    private let gradeThreshold: CGFloat = 50    // pt to commit a grade
    private let flyDistance: CGFloat = 300      // off-screen distance

    // ── Derived grade from current drag offset ────────────────────────────────

    private var previewGrade: ReviewQuality? {
        guard isRevealed else { return nil }
        let effectiveOffset = effectiveDragOffset

        if let axis = lockedAxis {
            switch axis {
            case .horizontal:
                if effectiveOffset.width > gradeThreshold  { return .easy }
                if effectiveOffset.width < -gradeThreshold { return .again }
            case .vertical:
                if effectiveOffset.height < -gradeThreshold { return .good }
                if effectiveOffset.height > gradeThreshold  { return .hard }
            }
        }
        return nil
    }

    private var badgeOpacity: Double {
        guard let grade = previewGrade else { return 0 }
        let _ = grade  // silence unused warning
        let magnitude = max(abs(offset.width), abs(offset.height))
        return min(1.0, Double((magnitude - gradeThreshold + 10) / 20))
    }

    // Constrain drag to the locked axis
    private var effectiveDragOffset: CGSize {
        guard let axis = lockedAxis else { return offset }
        switch axis {
        case .horizontal: return CGSize(width: offset.width, height: 0)
        case .vertical:   return CGSize(width: 0, height: offset.height)
        }
    }

    // Card tilt: slight rotation based on horizontal drag
    private var cardRotation: Angle {
        .degrees(Double(effectiveDragOffset.width) * 0.08)
    }

    // ── Body ──────────────────────────────────────────────────────────────────

    var body: some View {
        ZStack {
            // Card content
            content
                .offset(isFlying ? flyOffset : effectiveDragOffset)
                .rotationEffect(isFlying ? cardRotation : cardRotation)
                .animation(isFlying ? .easeIn(duration: 0.2) : nil, value: flyOffset)

            // Grade badge — centered, fades in as drag approaches threshold
            if let grade = previewGrade {
                GradeBadge(quality: grade, opacity: badgeOpacity)
                    .allowsHitTesting(false)
            }
        }
        .gesture(
            isRevealed && !isFlying
                ? DragGesture(minimumDistance: 5)
                    .onChanged(handleDragChanged)
                    .onEnded(handleDragEnded)
                : nil
        )
    }

    // ── Gesture handlers ──────────────────────────────────────────────────────

    private func handleDragChanged(_ value: DragGesture.Value) {
        let tx = value.translation.width
        let ty = value.translation.height

        // Lock axis once movement exceeds lockThreshold
        if lockedAxis == nil && (abs(tx) > lockThreshold || abs(ty) > lockThreshold) {
            lockedAxis = abs(tx) > abs(ty) ? .horizontal : .vertical
            didFireHaptic = false
        }

        offset = value.translation

        // Haptic click at threshold crossing (fires once per drag)
        if !didFireHaptic {
            let magnitude: CGFloat
            switch lockedAxis {
            case .horizontal: magnitude = abs(tx)
            case .vertical:   magnitude = abs(ty)
            case nil:         magnitude = 0
            }
            if magnitude >= gradeThreshold {
                WKInterfaceDevice.current().play(.click)
                didFireHaptic = true
            }
        }
    }

    private func handleDragEnded(_ value: DragGesture.Value) {
        let tx = value.translation.width
        let ty = value.translation.height

        var grade: ReviewQuality? = nil

        switch lockedAxis {
        case .horizontal:
            if tx > gradeThreshold       { grade = .easy }
            else if tx < -gradeThreshold { grade = .again }
        case .vertical:
            if ty < -gradeThreshold      { grade = .good }
            else if ty > gradeThreshold  { grade = .hard }
        case nil:
            break
        }

        if let grade {
            commitGrade(grade, tx: tx, ty: ty)
        } else {
            snapBack()
        }
    }

    // ── Commit + fly off ──────────────────────────────────────────────────────

    private func commitGrade(_ grade: ReviewQuality, tx: CGFloat, ty: CGFloat) {
        // Haptic feedback matching grade quality
        switch grade {
        case .easy: WKInterfaceDevice.current().play(.success)
        case .good: WKInterfaceDevice.current().play(.click)
        case .hard: WKInterfaceDevice.current().play(.notification)
        default:    WKInterfaceDevice.current().play(.failure)
        }

        // Fly the card off in the swipe direction
        isFlying = true
        switch grade {
        case .easy:  flyOffset = CGSize(width: flyDistance, height: 0)
        case .again: flyOffset = CGSize(width: -flyDistance, height: 0)
        case .good:  flyOffset = CGSize(width: 0, height: -flyDistance)
        default:     flyOffset = CGSize(width: 0, height: flyDistance)
        }

        // After fly-off animation, notify parent and reset
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.22) {
            onGrade(grade)
            resetDrag()
        }
    }

    private func snapBack() {
        withAnimation(.spring(response: 0.35, dampingFraction: 0.7)) {
            offset = .zero
        }
        resetDrag()
    }

    private func resetDrag() {
        offset = .zero
        flyOffset = .zero
        lockedAxis = nil
        didFireHaptic = false
        isFlying = false
    }
}

// ─── Axis enum ────────────────────────────────────────────────────────────────

private enum Axis {
    case horizontal, vertical
}

// ─── Color(hex:) helper ───────────────────────────────────────────────────────

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let r = Double((int >> 16) & 0xFF) / 255
        let g = Double((int >> 8)  & 0xFF) / 255
        let b = Double(int & 0xFF)         / 255
        self.init(red: r, green: g, blue: b)
    }
}
