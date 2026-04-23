import { useEffect, useRef } from 'react'
import { View, Text, StyleSheet, AccessibilityInfo } from 'react-native'
import { colors, spacing, radius } from '../../theme'

interface Props {
  /** When truthy, the banner is visible and the auto-dismiss timer runs. */
  visible: boolean
  /** Fires when the 1500ms auto-dismiss timer elapses. */
  onAutoDismiss: () => void
}

/**
 * Inline "Not quite. Try again." banner shown briefly between wrong attempts.
 * Auto-dismisses after ~1.5s. The parent may also dismiss on next mic tap;
 * this component only owns the timer.
 */
export function NotQuiteBanner({ visible, onAutoDismiss }: Props) {
  // Stash the latest callback in a ref so the effect can fire it without
  // needing to include onAutoDismiss in the dep array. This prevents the
  // timer from resetting on every parent re-render when onAutoDismiss is
  // an inline arrow.
  const onAutoDismissRef = useRef(onAutoDismiss)
  useEffect(() => {
    onAutoDismissRef.current = onAutoDismiss
  })

  useEffect(() => {
    if (!visible) return
    // Announce the transition so VoiceOver users hear the hint-reveal cue.
    AccessibilityInfo.announceForAccessibility('Not quite. Try again.')
    const id = setTimeout(() => onAutoDismissRef.current(), 1500)
    return () => clearTimeout(id)
  }, [visible])

  if (!visible) return null

  return (
    <View style={styles.banner} accessibilityLiveRegion="assertive">
      <Text style={styles.main}>Not quite. Try again.</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: 'rgba(166, 61, 61, 0.18)',
    borderColor: 'rgba(166, 61, 61, 0.35)',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginVertical: spacing.md,
    alignItems: 'center',
  },
  main: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },
})
