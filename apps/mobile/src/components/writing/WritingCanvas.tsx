import { useCallback, useRef, useState } from 'react'
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native'
import {
  Canvas,
  Path,
  Skia,
  useTouchHandler,
  useValue,
  SkPath,
  Paint,
  Circle,
} from '@shopify/react-native-skia'
import { Ionicons } from '@expo/vector-icons'
import { colors, spacing, radius, typography } from '../../theme'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Stroke {
  path: SkPath
  width: number
}

interface Props {
  size?: number
  strokeColor?: string
  strokeWidth?: number
  guideKanji?: string   // faint guide character shown behind canvas
  onStrokesChange?: (strokes: Stroke[]) => void
  onSubmit?: (strokes: Stroke[], strokeCount: number) => void
}

// ─── Writing Canvas ───────────────────────────────────────────────────────────

export function WritingCanvas({
  size = 300,
  strokeColor = colors.textPrimary,
  strokeWidth = 8,
  guideKanji,
  onStrokesChange,
  onSubmit,
}: Props) {
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [canUndo, setCanUndo] = useState(false)

  // Current in-progress path (updated every touch move)
  const currentPath = useValue<SkPath | null>(null)
  const isDrawing = useRef(false)

  const touchHandler = useTouchHandler({
    onStart: ({ x, y }) => {
      const path = Skia.Path.Make()
      path.moveTo(x, y)
      currentPath.current = path
      isDrawing.current = true
    },

    onActive: ({ x, y }) => {
      if (!isDrawing.current || !currentPath.current) return
      currentPath.current.lineTo(x, y)
      // Trigger re-render by reassigning
      currentPath.current = currentPath.current
    },

    onEnd: () => {
      if (!currentPath.current || !isDrawing.current) return
      isDrawing.current = false

      const completedPath = currentPath.current
      currentPath.current = null

      setStrokes((prev) => {
        const next = [...prev, { path: completedPath, width: strokeWidth }]
        onStrokesChange?.(next)
        setCanUndo(next.length > 0)
        return next
      })
    },
  })

  const handleUndo = useCallback(() => {
    setStrokes((prev) => {
      const next = prev.slice(0, -1)
      onStrokesChange?.(next)
      setCanUndo(next.length > 0)
      return next
    })
  }, [onStrokesChange])

  const handleClear = useCallback(() => {
    setStrokes([])
    currentPath.current = null
    setCanUndo(false)
    onStrokesChange?.([])
  }, [onStrokesChange])

  const handleSubmit = useCallback(() => {
    onSubmit?.(strokes, strokes.length)
  }, [strokes, onSubmit])

  return (
    <View style={styles.wrapper}>
      {/* Canvas */}
      <View style={[styles.canvasContainer, { width: size, height: size }]}>
        {/* Grid guide lines */}
        <View style={styles.grid} pointerEvents="none">
          <View style={styles.gridH} />
          <View style={styles.gridV} />
          <View style={styles.gridDiag1} />
          <View style={styles.gridDiag2} />
        </View>

        {/* Faint guide kanji */}
        {guideKanji && (
          <Text style={[styles.guideKanji, { fontSize: size * 0.75 }]} pointerEvents="none">
            {guideKanji}
          </Text>
        )}

        <Canvas style={{ width: size, height: size }} onTouch={touchHandler}>
          {/* Completed strokes */}
          {strokes.map((stroke, i) => (
            <Path
              key={i}
              path={stroke.path}
              color={strokeColor}
              style="stroke"
              strokeWidth={stroke.width}
              strokeCap="round"
              strokeJoin="round"
            />
          ))}

          {/* In-progress stroke */}
          {currentPath.current && (
            <Path
              path={currentPath.current}
              color={strokeColor}
              style="stroke"
              strokeWidth={strokeWidth}
              strokeCap="round"
              strokeJoin="round"
            />
          )}
        </Canvas>

        {/* Stroke count badge */}
        <View style={styles.strokeBadge}>
          <Text style={styles.strokeCount}>{strokes.length}</Text>
        </View>
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.controlBtn, !canUndo && styles.disabled]}
          onPress={handleUndo}
          disabled={!canUndo}
        >
          <Ionicons name="arrow-undo" size={20} color={canUndo ? colors.textSecondary : colors.textMuted} />
          <Text style={styles.controlLabel}>Undo</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlBtn, !canUndo && styles.disabled]}
          onPress={handleClear}
          disabled={!canUndo}
        >
          <Ionicons name="trash-outline" size={20} color={canUndo ? colors.error : colors.textMuted} />
          <Text style={[styles.controlLabel, canUndo && { color: colors.error }]}>Clear</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.submitBtn, !canUndo && styles.disabled]}
          onPress={handleSubmit}
          disabled={!canUndo}
        >
          <Ionicons name="checkmark" size={20} color="#fff" />
          <Text style={styles.submitLabel}>Submit</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', gap: spacing.md },
  canvasContainer: {
    borderRadius: radius.lg,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    position: 'relative',
  },
  grid: {
    position: 'absolute',
    inset: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridH: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: colors.border,
  },
  gridV: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: colors.border,
  },
  gridDiag1: {
    position: 'absolute',
    width: '141%',
    height: 1,
    backgroundColor: colors.divider,
    transform: [{ rotate: '45deg' }],
  },
  gridDiag2: {
    position: 'absolute',
    width: '141%',
    height: 1,
    backgroundColor: colors.divider,
    transform: [{ rotate: '-45deg' }],
  },
  guideKanji: {
    position: 'absolute',
    inset: 0,
    textAlign: 'center',
    textAlignVertical: 'center',
    color: colors.textMuted,
    opacity: 0.12,
    fontWeight: '300',
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
  controls: { flexDirection: 'row', gap: spacing.sm },
  controlBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.bgCard,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  controlLabel: { ...typography.bodySmall, color: colors.textSecondary },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  submitLabel: { ...typography.bodySmall, color: '#fff', fontWeight: '600' },
  disabled: { opacity: 0.4 },
})
