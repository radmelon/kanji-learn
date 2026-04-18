// apps/mobile/app/deleted.tsx
//
// Post-deletion farewell screen. Reached only via router.replace('/deleted')
// from the DeleteAccountModal after the API call succeeds. Lives outside the
// (auth) and (tabs) groups so it's not gated by either.

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { colors, spacing, radius, typography } from '../src/theme'

export default function DeletedScreen() {
  const router = useRouter()

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.container}>
        <Text style={styles.headline}>Your account has been deleted</Text>
        <Text style={styles.body}>
          We're sorry to see you go. All your data has been permanently removed.
        </Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.replace('/(auth)/sign-in')}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>OK</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
  },
  headline: {
    ...typography.h1,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    marginTop: spacing.lg,
  },
  buttonText: { ...typography.h3, color: '#fff' },
})
