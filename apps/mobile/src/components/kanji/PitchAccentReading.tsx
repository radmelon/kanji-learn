/**
 * PitchAccentReading.tsx
 *
 * Renders a kana reading with an NHK-style overline marking high-pitch
 * moras and a small drop-hook at each high→low transition. Accepts a
 * per-mora pitch pattern (0 = low, 1 = high) aligned via alignMoraToKana.
 *
 * Degrades to plain text when:
 * - enabled is false (user preference off),
 * - pattern is missing (no pitch data for this vocab entry),
 * - mora count and pattern length disagree (bad data — render safely).
 */

import { View, Text, StyleSheet, type TextStyle } from 'react-native'
import { colors } from '../../theme'
import { alignMoraToKana } from '../../lib/mora-alignment'

type Size = 'large' | 'medium' | 'small'

interface Props {
  reading: string
  pattern?: number[]
  enabled: boolean
  size?: Size
}

// Explicit text colour is required — React Native's default is black, which
// is invisible on this app's dark card backgrounds and fails WCAG 2.1 AA.
// colors.textPrimary (#F0F0F5) on bgCard (#1A1A2E) is ~15.5:1 — well above
// AA's 4.5:1 threshold for normal text.
const SIZE_STYLES: Record<Size, TextStyle> = {
  large:  { fontSize: 22, lineHeight: 30, letterSpacing: 1, color: colors.textPrimary },
  medium: { fontSize: 16, lineHeight: 22, letterSpacing: 1, color: colors.textPrimary },
  small:  { fontSize: 13, lineHeight: 18, letterSpacing: 1, color: colors.textPrimary },
}

export function PitchAccentReading({ reading, pattern, enabled, size = 'medium' }: Props) {
  const textStyle = SIZE_STYLES[size]

  if (!enabled || !pattern) {
    return <Text style={textStyle}>{reading}</Text>
  }

  const moras = alignMoraToKana(reading)
  if (moras.length !== pattern.length) {
    return <Text style={textStyle}>{reading}</Text>
  }

  return (
    <View style={styles.row}>
      {moras.map((mora, i) => {
        const isHigh = pattern[i] === 1
        const nextIsLow = i < pattern.length - 1 && pattern[i + 1] === 0
        const showDrop = isHigh && nextIsLow

        return (
          <View key={i} style={styles.moraWrap}>
            <Text
              style={[
                textStyle,
                isHigh && styles.high,
              ]}
            >
              {mora}
            </Text>
            {showDrop && <View style={styles.dropHook} />}
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  moraWrap: {
    position: 'relative',
  },
  high: {
    borderTopWidth: 2,
    borderTopColor: colors.accent,
  },
  dropHook: {
    position: 'absolute',
    top: 0,
    right: -3,
    width: 6,
    height: 6,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: colors.accent,
  },
})
