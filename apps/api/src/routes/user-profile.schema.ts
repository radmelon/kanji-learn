import { z } from 'zod'

export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(50).nullable().optional(),
  dailyGoal: z.number().int().min(5).max(200).optional(),
  notificationsEnabled: z.boolean().optional(),
  timezone: z.string().optional(),
  reminderHour: z.number().int().min(0).max(23).optional(),
  restDay: z.number().int().min(0).max(6).nullable().optional(),
  // Deliberately separate from restDay (weekly-review spec decision #8). NULL
  // is meaningful — it means "no appointment scheduled" and is a state a
  // learner can choose (e.g. clearing an existing appointment).
  buddyDay: z.number().int().min(0).max(6).nullable().optional(),
  buddyIntervalWeeks: z.number().int().min(1).max(2).optional(),
  onboardingCompletedAt: z.coerce.date().optional(),
  showPitchAccent: z.boolean().optional(),
  attachLocationToMilestones: z.boolean().optional(),
  // Plan 4. Distinct from attachLocationToMilestones by design (parent spec
  // §11) — consenting to location on badges is not consent on hooks.
  attachLocationToHooks: z.boolean().optional(),
  mnemonicCoachingEnabled: z.boolean().optional(),
  // Stamped when the one-time in-flow location ask has been answered. Lives
  // server-side so a reinstall does not re-ask (design spec §9).
  hookLocationAskSeenAt: z.coerce.date().optional(),
})
