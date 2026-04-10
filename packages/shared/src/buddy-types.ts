// packages/shared/src/buddy-types.ts
// All Buddy domain types shared between API and mobile app.
// Matches the columns defined in schema.ts Buddy tables — keep in sync.

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

export type ScaffoldLevel = 1 | 2 | 3

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

export interface LearnerStateCache {
  userId: string
  computedAt: Date
  currentStreak: number
  velocityTrend: VelocityTrend
  totalSeen: number
  totalBurned: number
  activeLeeches: number
  leechKanjiIds: number[]
  weakestModality?: WeakestModality
  strongestJlptLevel?: 'N5' | 'N4' | 'N3' | 'N2' | 'N1'
  currentFocusLevel?: 'N5' | 'N4' | 'N3' | 'N2' | 'N1'
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

export type ActivityType =
  | 'flashcard_review'
  | 'new_kanji'
  | 'quiz'
  | 'writing'
  | 'voice'
  | 'leech_drill'
  | 'mnemonic_review'
  | 'confused_pair_drill'

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
