import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useAuthStore } from '../../stores/auth.store'
import { colors, spacing, radius, typography } from '../../theme'

interface Props {
  mode: 'sign-in' | 'sign-up'
  disabled?: boolean
}

export function SocialAuthButtons({ mode, disabled }: Props) {
  const { signInWithApple, signInWithGoogle, socialLoading } = useAuthStore()

  const appleLabel = mode === 'sign-in' ? 'Continue with Apple' : 'Sign up with Apple'
  const googleLabel = mode === 'sign-in' ? 'Continue with Google' : 'Sign up with Google'

  const isDisabled = disabled || socialLoading

  const handleApple = async () => {
    try {
      await signInWithApple()
    } catch (err: any) {
      // Error toast handled by caller or ignored (user cancelled)
    }
  }

  const handleGoogle = async () => {
    try {
      await signInWithGoogle()
    } catch (err: any) {
      // Error toast handled by caller or ignored (user cancelled)
    }
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.appleButton, isDisabled && styles.buttonDisabled]}
        onPress={handleApple}
        disabled={isDisabled}
      >
        {socialLoading ? (
          <ActivityIndicator color="#000" size="small" />
        ) : (
          <>
            <Ionicons name="logo-apple" size={20} color="#000" style={styles.icon} />
            <Text style={styles.appleText}>{appleLabel}</Text>
          </>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.googleButton, isDisabled && styles.buttonDisabled]}
        onPress={handleGoogle}
        disabled={isDisabled}
      >
        {socialLoading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <Text style={styles.googleLogo}>G</Text>
            <Text style={styles.googleText}>{googleLabel}</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm + 2,
  },
  appleButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleButton: {
    backgroundColor: '#4285F4',
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  icon: {
    marginRight: spacing.sm,
  },
  appleText: {
    ...typography.h3,
    color: '#000000',
  },
  googleLogo: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    marginRight: spacing.sm,
  },
  googleText: {
    ...typography.h3,
    color: '#FFFFFF',
  },
})
