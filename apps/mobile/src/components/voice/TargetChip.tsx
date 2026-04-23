import { Text, StyleSheet } from 'react-native'
import { colors } from '../../theme'

interface Props {
  children: string
}

/**
 * Renders a single kanji character inside an amber chip — used to indicate
 * which kanji within a vocab word is being drilled on the Speaking card.
 * See docs/superpowers/specs/2026-04-22-speaking-progressive-hints-design.md.
 */
export function TargetChip({ children }: Props) {
  return (
    <Text
      style={styles.chip}
      accessibilityLabel={`target kanji ${children}`}
    >
      {children}
    </Text>
  )
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: colors.targetChipBg,
    color: colors.targetChipText,
    paddingHorizontal: 6,
    borderRadius: 8,
  },
})
