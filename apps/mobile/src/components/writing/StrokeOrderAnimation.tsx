import { useEffect, useRef, useState, useCallback } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Animated, ActivityIndicator } from 'react-native'
import Svg, { Path, G } from 'react-native-svg'
import { Ionicons } from '@expo/vector-icons'
import { useKanjiStrokes } from '../../hooks/useKanjiStrokes'
import { colors, spacing, radius, typography } from '../../theme'

// ─── Constants ────────────────────────────────────────────────────────────────

const DASH_LENGTH = 400   // larger than any single KanjiVG stroke path
const KVGBOX = '0 0 109 109'

type SpeedLevel = 'slow' | 'normal' | 'fast'

const SPEED_PRESETS: Record<SpeedLevel, { duration: number; gap: number; label: string }> = {
  slow:   { duration: 1200, gap: 300,  label: 'Slow'   },
  normal: { duration: 550,  gap: 100,  label: 'Normal' },
  fast:   { duration: 250,  gap: 60,   label: 'Fast'   },
}

const COLOR_GUIDE  = colors.textMuted   // dim guide behind unplayed strokes
const COLOR_DONE   = colors.textSecondary
const COLOR_ACTIVE = colors.primary

// ─── Animated SVG Path ────────────────────────────────────────────────────────

const AnimatedPath = Animated.createAnimatedComponent(Path)

interface StrokeLayerProps {
  d: string
  phase: 'guide' | 'animating' | 'done'
  animValue: Animated.Value  // 0 → 1 during animation
}

function StrokeLayer({ d, phase, animValue }: StrokeLayerProps) {
  // The "draw" overlay: starts hidden (dashOffset = DASH_LENGTH), animates to 0
  const dashOffset = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: [DASH_LENGTH, 0],
  })

  return (
    <G>
      {/* Always-visible guide stroke — shows shape before it's animated */}
      <Path
        d={d}
        stroke={phase === 'done' ? COLOR_DONE : COLOR_GUIDE}
        strokeWidth={phase === 'done' ? 3.5 : 2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity={phase === 'guide' ? 0.2 : 0.9}
      />
      {/* Animated overlay — draws on top in primary colour */}
      {(phase === 'animating' || phase === 'done') && (
        <AnimatedPath
          d={d}
          stroke={phase === 'animating' ? COLOR_ACTIVE : COLOR_DONE}
          strokeWidth={phase === 'animating' ? 4.5 : 3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          strokeDasharray={`${DASH_LENGTH} ${DASH_LENGTH}`}
          strokeDashoffset={dashOffset}
          opacity={0.95}
        />
      )}
    </G>
  )
}

// ─── Stroke Order Animation ───────────────────────────────────────────────────

interface Props {
  character: string
  width?: number
  height?: number
  onDone?: () => void
}

export function StrokeOrderAnimation({ character, width = 335, height = 260, onDone }: Props) {
  const { strokes, isLoading, error } = useKanjiStrokes(character)
  const [currentStroke, setCurrentStroke] = useState(-1)  // -1 = not started
  const [isPlaying, setIsPlaying] = useState(false)
  const [isDone, setIsDone] = useState(false)
  const [speedLevel, setSpeedLevel] = useState<SpeedLevel>('normal')
  const animValues = useRef<Animated.Value[]>([])
  const animationRef = useRef<Animated.CompositeAnimation | null>(null)
  const timeoutRefs = useRef<ReturnType<typeof setTimeout>[]>([])

  // Initialise anim values when stroke data arrives, then auto-play
  useEffect(() => {
    if (strokes.length === 0) return
    animValues.current = strokes.map(() => new Animated.Value(0))
    setCurrentStroke(-1)
    setIsDone(false)
    setIsPlaying(false)
    // Auto-play after a short settle delay
    const t = setTimeout(() => playFrom(0), 300)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes])

  // Clear timeouts on unmount
  useEffect(() => {
    return () => {
      animationRef.current?.stop()
      timeoutRefs.current.forEach(clearTimeout)
    }
  }, [])

  const playFrom = useCallback((startIndex: number, speed: SpeedLevel = speedLevel) => {
    if (strokes.length === 0) return
    const { duration, gap } = SPEED_PRESETS[speed]

    // Stop any running animation
    animationRef.current?.stop()
    timeoutRefs.current.forEach(clearTimeout)
    timeoutRefs.current = []

    // Reset anim values from startIndex
    for (let i = startIndex; i < animValues.current.length; i++) {
      animValues.current[i].setValue(0)
    }

    setIsPlaying(true)
    setIsDone(false)
    setCurrentStroke(startIndex)

    // Schedule chip highlights
    let delay = 0
    strokes.slice(startIndex).forEach((_, i) => {
      const absIdx = startIndex + i
      const t = setTimeout(() => setCurrentStroke(absIdx), delay)
      timeoutRefs.current.push(t)
      delay += duration + gap
    })

    // Build animation sequence
    const sequence = strokes.slice(startIndex).flatMap((_, i) => [
      Animated.timing(animValues.current[startIndex + i], {
        toValue: 1,
        duration,
        useNativeDriver: false,
      }),
      Animated.delay(gap),
    ])

    animationRef.current = Animated.sequence(sequence)
    animationRef.current.start(({ finished }) => {
      if (finished) {
        setIsPlaying(false)
        setIsDone(true)
        setCurrentStroke(strokes.length) // past last stroke → all "done"
        onDone?.()
      }
    })
  }, [strokes, onDone, speedLevel])

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      animationRef.current?.stop()
      timeoutRefs.current.forEach(clearTimeout)
      timeoutRefs.current = []
      setIsPlaying(false)
    } else {
      playFrom(isDone ? 0 : Math.max(0, currentStroke))
    }
  }, [isPlaying, isDone, currentStroke, playFrom])

  const handleReplay = useCallback(() => {
    animValues.current.forEach((v) => v.setValue(0))
    playFrom(0)
  }, [playFrom])

  const handleSpeedChange = useCallback((level: SpeedLevel) => {
    setSpeedLevel(level)
    // If currently playing, restart from beginning at the new speed
    if (isPlaying || isDone) {
      animValues.current.forEach((v) => v.setValue(0))
      setIsDone(false)
      playFrom(0, level)
    }
  }, [isPlaying, isDone, playFrom])

  // ── Loading / error ────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <View style={[styles.placeholder, { width, height }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.placeholderText}>Loading stroke order…</Text>
      </View>
    )
  }

  if (error || strokes.length === 0) {
    return (
      <View style={[styles.placeholder, { width, height }]}>
        <Ionicons name="alert-circle-outline" size={32} color={colors.textMuted} />
        <Text style={styles.placeholderText}>Stroke order unavailable</Text>
      </View>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={styles.wrapper}>
      {/* Canvas */}
      <View style={[styles.canvas, { width, height }]}>
        {/* Grid */}
        <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Path d={`M${width/2} 0 L${width/2} ${height}`} stroke={colors.divider} strokeWidth={0.5} strokeDasharray="4 4" />
          <Path d={`M 0 ${height/2} L${width} ${height/2}`} stroke={colors.divider} strokeWidth={0.5} strokeDasharray="4 4" />
          <Path d={`M16 16 L${width-16} 16 L${width-16} ${height-16} L16 ${height-16} Z`} stroke={colors.divider} strokeWidth={0.5} fill="none" />
        </Svg>

        {/* KanjiVG strokes — viewBox scales 109×109 to canvas */}
        <Svg width={width} height={height} viewBox={KVGBOX} style={StyleSheet.absoluteFill} pointerEvents="none">
          <G>
            {strokes.map((stroke, i) => {
              const anim = animValues.current[i]
              if (!anim) return null
              const phase =
                i < currentStroke    ? 'done'
                : i === currentStroke  ? 'animating'
                : 'guide'
              return <StrokeLayer key={i} d={stroke.d} phase={phase} animValue={anim} />
            })}
          </G>
        </Svg>

        {/* Active stroke number badge */}
        {isPlaying && currentStroke >= 0 && currentStroke < strokes.length && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{currentStroke + 1}</Text>
          </View>
        )}
        {isDone && (
          <View style={[styles.badge, { backgroundColor: colors.success + '33' }]}>
            <Ionicons name="checkmark" size={14} color={colors.success} />
          </View>
        )}
      </View>

      {/* Stroke chips */}
      <View style={styles.chips}>
        {strokes.map((_, i) => {
          const done = i < currentStroke || isDone
          const active = i === currentStroke && isPlaying
          return (
            <View key={i} style={[styles.chip, done && styles.chipDone, active && styles.chipActive]}>
              <Text style={[styles.chipText, done && styles.chipDone2, active && styles.chipActive2]}>
                {i + 1}
              </Text>
            </View>
          )
        })}
      </View>

      {/* Speed picker */}
      <View style={styles.speedRow}>
        {(Object.keys(SPEED_PRESETS) as SpeedLevel[]).map((level) => (
          <TouchableOpacity
            key={level}
            style={[styles.speedBtn, speedLevel === level && styles.speedBtnActive]}
            onPress={() => handleSpeedChange(level)}
          >
            <Text style={[styles.speedBtnText, speedLevel === level && styles.speedBtnTextActive]}>
              {SPEED_PRESETS[level].label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity style={styles.sideBtn} onPress={handleReplay}>
          <Ionicons name="refresh" size={18} color={colors.textSecondary} />
          <Text style={styles.sideBtnText}>Replay</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.playBtn} onPress={handlePlayPause}>
          <Ionicons name={isPlaying ? 'pause' : 'play'} size={22} color="#fff" />
          <Text style={styles.playBtnText}>{isPlaying ? 'Pause' : 'Play'}</Text>
        </TouchableOpacity>

        <View style={styles.sideBtn}>
          <Text style={styles.progressText}>
            {isDone ? 'Done' : currentStroke >= 0 ? `${currentStroke + 1}/${strokes.length}` : `${strokes.length} strokes`}
          </Text>
        </View>
      </View>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md },

  placeholder: {
    alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.bgCard, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  placeholderText: { ...typography.caption, color: colors.textMuted },

  canvas: {
    borderRadius: radius.lg, backgroundColor: colors.bgCard,
    borderWidth: 1, borderColor: colors.border,
    overflow: 'hidden', position: 'relative',
  },
  badge: {
    position: 'absolute', top: spacing.xs, right: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radius.full, minWidth: 26, height: 26,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  badgeText: { ...typography.caption, color: '#fff', fontWeight: '700' },

  chips: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' },
  chip: {
    width: 28, height: 28, borderRadius: radius.sm,
    backgroundColor: colors.bgCard, borderWidth: 0.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  chipDone: { backgroundColor: '#1A3D35', borderColor: colors.success },
  chipActive: { backgroundColor: colors.bgElevated, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  chipDone2: { color: colors.success },
  chipActive2: { color: colors.primary },

  controls: { flexDirection: 'row', gap: spacing.sm, width: '100%', alignItems: 'center' },
  sideBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: spacing.sm + 2,
    backgroundColor: colors.bgCard, borderRadius: radius.md,
    borderWidth: 0.5, borderColor: colors.border,
  },
  sideBtnText: { ...typography.bodySmall, color: colors.textSecondary },
  progressText: { ...typography.bodySmall, color: colors.textMuted },
  playBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: spacing.sm + 2,
    backgroundColor: colors.primary, borderRadius: radius.md,
  },
  playBtnText: { ...typography.bodySmall, color: '#fff', fontWeight: '600' },

  speedRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    alignSelf: 'center',
  },
  speedBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
  },
  speedBtnActive: {
    backgroundColor: colors.primary + '22',
    borderColor: colors.primary,
  },
  speedBtnText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
  },
  speedBtnTextActive: {
    color: colors.primary,
  },
})
