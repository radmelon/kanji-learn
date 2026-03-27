// Progress & analytics — full implementation in commit 14
import { View, Text, StyleSheet } from 'react-native'
import { colors, typography } from '../../src/theme'

export default function Progress() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Progress</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  text: { ...typography.h2, color: colors.textPrimary },
})
