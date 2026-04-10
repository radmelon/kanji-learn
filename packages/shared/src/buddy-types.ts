// packages/shared/src/buddy-types.ts
// Buddy domain types shared between API and mobile app.
//
// Most of these mirror columns in the Buddy tables in packages/db/src/schema.ts
// (camelCase here, snake_case in the DB via Drizzle column mappings). A few
// exceptions are called out inline:
//   - LearnerStateCache matches the `learner_state_cache` row shape.
//   - StudyPlan.scaffoldLevel uses the string form; the DB column is a
//     smallint encoding — see the comment on StudyPlan.
//   - CoCreationSession is an in-memory session shape used during
//     co-created mnemonic flows. It is not persisted directly; the final
//     result is stored on `mnemonics.cocreation_context` (jsonb).

export type BuddyScreen =
  | 'dashboard'
  | 'study'
  | 'journal'
  | 'write'
  | 'speak'
  | 'progress'

export type NudgeType =
  | 'encouragement'
  | 'activity_suggestion'
  | 'leech_alert'
  | 'milestone'
  | 'streak'
  | 'mnemonic_refresh'
  | 'study_plan'
  | 'social_peer'
  | 'social_challenge'
  | 'social_rescue'

export type DeviceType = 'iphone' | 'ipad' | 'watch'

export type DeliveryTarget = 'app' | 'watch' | 'push' | 'all'

export type GeneratedBy = 'template' | 'on_device' | 'cloud'

export type BuddyMood = 'celebratory' | 'supportive' | 'challenging' | 'concerned'

export type VelocityTrend =
  | 'accelerating'
  | 'steady'
  | 'decelerating'
  | 'inactive'

export type WeakestModality =
  | 'meaning'
  | 'reading'
  | 'writing'
  | 'voice'
  | 'compound'

// Canonical scaffold level. Matches `learner_state_cache.scaffold_level` (text)
// and the API-internal ScaffoldLevel declared in
// apps/api/src/services/buddy/constants.ts (Task 15). The `study_plans`
// table stores this as a smallint encoding — the mapping lives in the
// StudyPlanService mapper (Phase 1).
export type ScaffoldLevel = 'heavy' | 'medium' | 'light'

export type BuddyPersonalityPref = 'encouraging' | 'direct' | 'playful'

export type StudyLogMood =
  | 'aha'
  | 'struggle'
  | 'breakthrough'
  | 'fun'
  | 'confused'

export type NudgeActionType =
  | 'navigate'
  | 'start_drill'
  | 'view_kanji'
  | 'generate_mnemonic'
  | 'dismiss'
  | 'none'

export type ActivityType =
  | 'flashcard_review'
  | 'new_kanji'
  | 'quiz'
  | 'writing'
  | 'voice'
  | 'leech_drill'
  | 'mnemonic_review'
  | 'confused_pair_drill'

export interface FriendComparison {
  friendId: string
  displayName: string
  metric: string
  value: number
  delta: number
}

export interface Milestone {
  type: string
  achievedAt: string
  payload: Record<string, unknown>
}

export interface StudyPatterns {
  preferredTime?: 'morning' | 'midday' | 'evening' | 'night'
  avgSessionsPerDay: number
  weekendVsWeekdayRatio: number
}

// Mirrors `learner_state_cache` in packages/db/src/schema.ts. Field names
// match the Drizzle table one-to-one so the service layer can pass rows
// through with minimal mapping. Keep in sync with the DB.
//
// Note: the transient `ComputedLearnerState` produced by LearnerStateService
// (Task 16) uses `computedAt` as its own field name and maps it to
// `updatedAt` on write. The two types intentionally serve different layers —
// do not unify them.
export interface LearnerStateCache {
  userId: string
  updatedAt: Date
  currentStreakDays: number
  longestStreakDays: number
  velocityTrend: VelocityTrend
  totalKanjiSeen: number
  totalKanjiBurned: number
  activeLeechCount: number
  leechKanjiIds: number[]
  weakestModality: WeakestModality
  strongestJlptLevel?: 'N5' | 'N4' | 'N3' | 'N2' | 'N1'
  currentFocusLevel?: 'N5' | 'N4' | 'N3' | 'N2' | 'N1'
  recentAccuracy: number // 0–1, average across modalities
  lastSessionAt?: Date
  avgDailyReviews: number
  avgSessionDurationMs: number
  daysSinceLastSession: number
  daysSinceFirstSession: number
  quizVsSrsGapHigh: boolean
  primaryDevice?: DeviceType
  deviceDistribution: Partial<Record<DeviceType, number>>
  watchSessionAvgCards?: number
  recentMilestones: Milestone[]
  studyPatterns: StudyPatterns
  nextRecommendedActivity?: string
  buddyMood: BuddyMood
  scaffoldLevel: ScaffoldLevel
  friendsCount: number
  activeFriendsToday: number
  friendsAheadOnBurn: FriendComparison[]
  friendsBehindOnBurn: FriendComparison[]
  friendsAheadOnStreak: FriendComparison[]
  friendsBehindOnStreak: FriendComparison[]
  userStrengthsVsFriends: Record<string, string>
  groupMomentum?: 'rising' | 'steady' | 'falling'
}

export interface BuddyNudge {
  id: string
  userId: string
  screen: BuddyScreen
  nudgeType: NudgeType
  content: string
  watchSummary?: string
  actionType?: NudgeActionType
  actionPayload?: Record<string, unknown>
  priority: number
  deliveryTarget: DeliveryTarget
  watchDeliveredAt?: Date
  pushDeliveredAt?: Date
  expiresAt: Date
  dismissedAt?: Date
  generatedBy: GeneratedBy
  deviceType?: DeviceType
  socialFraming: boolean
  createdAt: Date
}

export interface StudyActivity {
  order: number
  type: ActivityType
  kanjiIds?: number[]
  duration: number // minutes
  reason: string
  loopStage: 1 | 2 | 3 | 4 | 5
  socialFraming?: boolean
  completed: boolean
  skipped: boolean
}

// Domain shape for a study plan. The DB column `study_plans.scaffold_level`
// is a smallint; the mapping between that integer and the string
// ScaffoldLevel lives in the StudyPlanService mapper (Phase 1).
export interface StudyPlan {
  id: string
  userId: string
  activities: StudyActivity[]
  rationale: string
  scaffoldLevel: ScaffoldLevel
  generatedAt: Date
  deviceType?: DeviceType
  completedCount: number
  skippedCount: number
  expiresAt: Date
}

export interface StudyLogEntry {
  id: string
  userId: string
  kanjiId: number
  mnemonicId?: string
  userNote?: string
  exampleSentence?: string
  sentenceReading?: string
  sentenceTranslation?: string
  photoUrls: string[]
  audioNoteUrl?: string
  locationLat?: number
  locationLng?: number
  locationName?: string
  tags: string[]
  mood?: StudyLogMood
  sharedWithFriends: boolean
  createdAt: Date
  updatedAt: Date
  lastViewedAt?: Date
}

// In-memory shape tracked by the Buddy co-creation flow while a user
// builds a personal mnemonic. Not a DB row: the finished mnemonic is
// written to `mnemonics.cocreation_context` (jsonb). Phase 0 defines
// the type so API/mobile stay aligned when the flow is implemented.
export interface CoCreationSession {
  id: string
  userId: string
  kanjiId: number
  stage:
    | 'consent'
    | 'location_inference'
    | 'detail_elicitation'
    | 'assembly'
    | 'commitment'
  location?: {
    lat: number
    lng: number
    name: string
    type: string
  }
  questions: string[]
  answers: string[]
  draftMnemonic?: string
  finalMnemonic?: string
  startedAt: Date
  completedAt?: Date
}
