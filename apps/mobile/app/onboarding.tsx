import { Redirect } from 'expo-router'

// Placeholder front door: Task 13 replaces this with the meeting-Buddy
// conversation. Until then the form IS onboarding, so nothing regresses.
export default function OnboardingScreen() {
  return <Redirect href="/onboarding-form" />
}
