// Study session entry point — full implementation in commit 11
import { View, Text, StyleSheet } from 'react-native'
import { colors, typography } from '../../src/theme'

export default function Study() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Study</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  text: { ...typography.h2, color: colors.textPrimary },
})
