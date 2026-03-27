// Kanji detail screen — referenced from study session and journal
import { View, Text, StyleSheet } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { colors, typography } from '../../src/theme'

export default function KanjiDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Kanji #{id}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  text: { ...typography.h2, color: colors.textPrimary },
})
