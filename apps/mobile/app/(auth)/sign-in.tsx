import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native'
import { Link } from 'expo-router'
import { useAuthStore } from '../../src/stores/auth.store'
import { colors, spacing, radius, typography } from '../../src/theme'
import { SocialAuthButtons } from '../../src/components/auth/SocialAuthButtons'

export default function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { signIn, isLoading, socialLoading } = useAuthStore()

  const handleSignIn = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields')
      return
    }
    try {
      await signIn(email.trim().toLowerCase(), password)
    } catch (err: any) {
      Alert.alert('Sign in failed', err.message ?? 'Please check your credentials')
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={styles.kanji}>漢字</Text>
        <Text style={styles.title}>Kanji Learn</Text>
        <Text style={styles.subtitle}>Master 2,136 Jōyō kanji</Text>

        <SocialAuthButtons mode="sign-in" disabled={isLoading} />
        <Text style={styles.socialHint}>First time? We'll set you up automatically.</Text>

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textMuted}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.textMuted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity
          style={[styles.button, (isLoading || socialLoading) && styles.buttonDisabled]}
          onPress={handleSignIn}
          disabled={isLoading || socialLoading}
        >
          <Text style={styles.buttonText}>{isLoading ? 'Signing in…' : 'Sign in'}</Text>
        </TouchableOpacity>

        <Link href="/(auth)/sign-up" asChild>
          <TouchableOpacity style={styles.link}>
            <Text style={styles.linkText}>Sign up with email →</Text>
          </TouchableOpacity>
        </Link>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  kanji: {
    ...typography.kanjiDisplay,
    color: colors.primary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  title: { ...typography.h1, color: colors.textPrimary, textAlign: 'center' },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.lg },
  input: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    color: colors.textPrimary,
    ...typography.body,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { ...typography.h3, color: '#fff' },
  link: { alignItems: 'center', paddingVertical: spacing.sm },
  linkText: { ...typography.body, color: colors.accent },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  socialHint: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: -spacing.xs,
  },
})
