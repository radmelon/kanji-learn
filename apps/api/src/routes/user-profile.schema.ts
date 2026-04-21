import { z } from 'zod'

export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(50).nullable().optional(),
  dailyGoal: z.number().int().min(5).max(200).optional(),
  notificationsEnabled: z.boolean().optional(),
  timezone: z.string().optional(),
  reminderHour: z.number().int().min(0).max(23).optional(),
  restDay: z.number().int().min(0).max(6).nullable().optional(),
  onboardingCompletedAt: z.coerce.date().optional(),
  showPitchAccent: z.boolean().optional(),
})
