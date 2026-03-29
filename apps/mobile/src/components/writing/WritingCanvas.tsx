import { useCallback, useRef, useState } from 'react'
import { View, StyleSheet, TouchableOpacity, Text, PanResponder } from 'react-native'
import Svg, { Path, Text as SvgText } from 'react-native-svg'
import { Ionicons } from '@expo/vector-icons'
import { colors, spacing, radius, typography } from '../../theme'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Point { x: number; y: number }

interface Stroke { points: Point[] }

interface Props {
  width?: number
  height?: number
  strokeColor?: string
  strokeWidth?: number
  guideKanji?: string
  disabled?: boolean
  onDrawingChange?: (isDrawing: boolean) => void
  onStrokeAdded?: (strokeCount: number) => void
  onStrokesChange?: (strokes: Stroke[]) => void
  onSubmit?: (strokes: Stroke[], strokeCount: number) => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pointsToPath(points: Point[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) {
    const { x, y } = points[0]
    return `M ${x} ${y} L ${x + 0.1} ${y}`
  }
  const [first, ...rest] = points
  return `M ${first.x} ${first.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(' ')
}

// ─── Writing Canvas ───────────────────────────────────────────────────────────

export function WritingCanvas({
  width = 335,
  height = 260,
  strokeColor = colors.primary,
  strokeWidth = 8,
  guideKanji,
  disabled = false,
  onDrawingChange,
  onStrokeAdded,
  onStrokesChange,
  onSubmit,
}: Props) {
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [currentPoints, setCurrentPoints] = useState<Point[]>([])
  const isDrawing = useRef(false)
  const canvasRef = useRef<View>(null)

  // Keep strokes in a ref so we can read the current value synchronously
  // and call callbacks OUTSIDE of setState updaters (calling setState inside
  // a setState updater triggers "Cannot update a component while rendering").
  const strokesRef = useRef<Stroke[]>([])
  const currentPointsRef = useRef<Point[]>([])

  const panResponder = useRef(
    PanResponder.create({
      // Use capture-phase variants so we claim the gesture BEFORE any
      // parent ScrollView or gesture handler gets a chance to steal it.
      // This also ensures Apple Pencil events (UITouchTypePencil) are captured.
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onStartShouldSetPanResponderCapture: () => !disabled,
      onMoveShouldSetPanResponderCapture: () => !disabled,

      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent
        isDrawing.current = true
        onDrawingChange?.(true)
        currentPointsRef.current = [{ x: locationX, y: locationY }]
        setCurrentPoints(currentPointsRef.current)
      },

      onPanResponderMove: (evt) => {
        if (!isDrawing.current) return
        const { locationX, locationY } = evt.nativeEvent
        currentPointsRef.current = [...currentPointsRef.current, { x: locationX, y: locationY }]
        setCurrentPoints(currentPointsRef.current)
      },

      onPanResponderRelease: () => {
        if (!isDrawing.current) return
        isDrawing.current = false
        onDrawingChange?.(false)

        const pts = currentPointsRef.current
        currentPointsRef.current = []
        setCurrentPoints([])

        if (pts.length > 0) {
          // Update ref first, then setState, then fire callbacks — all outside
          // any setState updater so React never sees a setState-during-render.
          strokesRef.current = [...strokesRef.current, { points: pts }]
          setStrokes(strokesRef.current)
          onStrokesChange?.(strokesRef.current)
          onStrokeAdded?.(strokesRef.current.length)
        }
      },
    })
  ).current

  const handleUndo = useCallback(() => {
    strokesRef.current = strokesRef.current.slice(0, -1)
    setStrokes(strokesRef.current)
    onStrokesChange?.(strokesRef.current)
    onStrokeAdded?.(strokesRef.current.length)
  }, [onStrokesChange, onStrokeAdded])

  const handleClear = useCallback(() => {
    strokesRef.current = []
    setStrokes([])
    setCurrentPoints([])
    currentPointsRef.current = []
    onStrokesChange?.([])
    onStrokeAdded?.(0)
  }, [onStrokesChange, onStrokeAdded])

  const handleSubmit = useCallback(() => {
    onSubmit?.(strokes, strokes.length)
  }, [strokes, onSubmit])

  const canUndo = strokes.length > 0 && !disabled

  return (
    <View style={styles.wrapper}>
      {/* Canvas */}
      <View
        ref={canvasRef}
        style={[styles.canvasContainer, { width, height }]}
        {...panResponder.panHandlers}
      >
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          {/* Grid lines */}
          <Path
            d={`M ${width / 2} 0 L ${width / 2} ${height}`}
            stroke={colors.divider}
            strokeWidth={0.5}
            strokeDasharray="4 4"
          />
          <Path
            d={`M 0 ${height / 2} L ${width} ${height / 2}`}
            stroke={colors.divider}
            strokeWidth={0.5}
            strokeDasharray="4 4"
          />
          {/* Outer inset border */}
          <Path
            d={`M 16 16 L ${width - 16} 16 L ${width - 16} ${height - 16} L 16 ${height - 16} Z`}
            stroke={colors.divider}
            strokeWidth={0.5}
            fill="none"
          />

          {/* Ghost guide kanji */}
          {guideKanji && (
            <SvgText
              x={width / 2}
              y={height / 2 + Math.min(width, height) * 0.26}
              textAnchor="middle"
              fontSize={Math.min(width, height) * 0.72}
              fill={colors.textMuted}
              opacity={0.13}
              fontWeight="300"
            >
              {guideKanji}
            </SvgText>
          )}

          {/* Completed strokes */}
          {strokes.map((stroke, i) => (
            <Path
              key={i}
              d={pointsToPath(stroke.points)}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ))}

          {/* In-progress stroke */}
          {currentPoints.length > 0 && (
            <Path
              d={pointsToPath(currentPoints)}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          )}
        </Svg>

        {/* Stroke count badge */}
        <View style={styles.strokeBadge} pointerEvents="none">
          <Text style={styles.strokeCount}>{strokes.length}</Text>
        </View>
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.controlBtn, !canUndo && styles.btnDisabled]}
          onPress={handleUndo}
          disabled={!canUndo}
        >
          <Ionicons name="arrow-undo" size={18} color={canUndo ? colors.textSecondary : colors.textMuted} />
          <Text style={styles.controlLabel}>Undo</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlBtn, !canUndo && styles.btnDisabled]}
          onPress={handleClear}
          disabled={!canUndo}
        >
          <Ionicons name="trash-outline" size={18} color={canUndo ? colors.error : colors.textMuted} />
          <Text style={[styles.controlLabel, canUndo && { color: colors.error }]}>Clear</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.submitBtn, (strokes.length === 0 || disabled) && styles.btnDisabled]}
          onPress={handleSubmit}
          disabled={strokes.length === 0 || disabled}
        >
          <Ionicons name="checkmark" size={18} color="#fff" />
          <Text style={styles.submitLabel}>{disabled ? 'Submitted' : 'Submit'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md },
  canvasContainer: {
    borderRadius: radius.lg,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    position: 'relative',
  },
  strokeBadge: {
    position: 'absolute',
    top: spacing.xs,
    left: spacing.xs,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.full,
    minWidth: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  strokeCount: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  controls: { flexDirection: 'row', gap: spacing.sm, width: '100%' },
  controlBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.bgCard,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 0.5,
    borderColor: colors.border,
  },
  controlLabel: { ...typography.bodySmall, color: colors.textSecondary },
  submitBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
  },
  submitLabel: { ...typography.bodySmall, color: '#fff', fontWeight: '600' },
  btnDisabled: { opacity: 0.35 },
})
