// Mnemonic journal — full implementation in commit 13
import { View, Text, StyleSheet } from 'react-native'
import { colors, typography } from '../../src/theme'

export default function Journal() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Mnemonic Journal</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  text: { ...typography.h2, color: colors.textPrimary },
})
