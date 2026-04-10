import {
  pgTable,
  pgEnum,
  serial,
  varchar,
  text,
  integer,
  smallint,
  real,
  boolean,
  timestamp,
  uuid,
  jsonb,
  numeric,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ─── Enums ────────────────────────────────────────────────────────────────────

export const jlptLevelEnum = pgEnum('jlpt_level', ['N5', 'N4', 'N3', 'N2', 'N1'])

export const srsStatusEnum = pgEnum('srs_status', [
  'unseen',
  'learning',
  'reviewing',
  'remembered',
  'burned',
])

export const mnemonicTypeEnum = pgEnum('mnemonic_type', ['system', 'user'])

export const reviewTypeEnum = pgEnum('review_type', [
  'meaning',
  'reading',
  'writing',
  'compound',
])

export const interventionTypeEnum = pgEnum('intervention_type', [
  'absence',
  'velocity_drop',
  'plateau',
])

export const deviceTypeEnum = pgEnum('device_type', ['iphone', 'ipad', 'watch'])

export const buddyMoodEnum = pgEnum('buddy_mood', [
  'celebratory',
  'supportive',
  'challenging',
  'concerned',
])

export const velocityTrendEnum = pgEnum('velocity_trend', [
  'accelerating',
  'steady',
  'decelerating',
  'inactive',
])

export const weakestModalityEnum = pgEnum('weakest_modality', [
  'meaning',
  'reading',
  'writing',
  'voice',
  'compound',
])

export const buddyPersonalityEnum = pgEnum('buddy_personality', [
  'encouraging',
  'direct',
  'playful',
])

export const mnemonicGenerationMethodEnum = pgEnum('mnemonic_generation_method', [
  'system',
  'user',
  'cocreated',
])

export const llmTierEnum = pgEnum('llm_tier', ['tier1', 'tier2', 'tier3'])

export const studyLogMoodEnum = pgEnum('study_log_mood', [
  'aha',
  'struggle',
  'breakthrough',
  'fun',
  'confused',
])

// ─── kanji ────────────────────────────────────────────────────────────────────

export const kanji = pgTable(
  'kanji',
  {
    id: serial('id').primaryKey(),
    character: text('character').notNull().unique(),
    jlptLevel: jlptLevelEnum('jlpt_level').notNull(),
    jlptOrder: integer('jlpt_order').notNull(), // ordering within level N5=1..80, etc.
    strokeCount: smallint('stroke_count').notNull(),
    meanings: jsonb('meanings').$type<string[]>().notNull().default([]),
    kunReadings: jsonb('kun_readings').$type<string[]>().notNull().default([]),
    onReadings: jsonb('on_readings').$type<string[]>().notNull().default([]),
    exampleVocab: jsonb('example_vocab')
      .$type<{ word: string; reading: string; meaning: string }[]>()
      .notNull()
      .default([]),
    exampleSentences: jsonb('example_sentences')
      .$type<{ ja: string; en: string; vocab: string }[]>()
      .notNull()
      .default([]),
    radicals: jsonb('radicals').$type<string[]>().notNull().default([]),
    svgPath: text('svg_path'), // KanjiVG stroke order SVG

    // ── KANJIDIC2 reference codes ──────────────────────────────────────────
    // Sourced from KANJIDIC2 (EDRDG, CC BY-SA 4.0). See ACKNOWLEDGEMENTS.
    jisCode:          varchar('jis_code', { length: 8 }),          // JIS X 0208 hex e.g. '3021'
    nelsonClassic:    integer('nelson_classic'),                    // Classic Nelson index
    nelsonNew:        integer('nelson_new'),                        // New Nelson (Haig 1997) index
    morohashiIndex:   integer('morohashi_index'),                   // Dai Kan-Wa Jiten entry number
    morohashiVolume:  smallint('morohashi_volume'),                 // Volume 1–13
    morohashiPage:    smallint('morohashi_page'),                   // Page within volume

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    jlptLevelOrderIdx: index('kanji_jlpt_level_order_idx').on(t.jlptLevel, t.jlptOrder),
  })
)

// ─── user_profiles ────────────────────────────────────────────────────────────
// Mirrors auth.users from Supabase; extended profile data lives here.

export const userProfiles = pgTable('user_profiles', {
  id: uuid('id').primaryKey(), // matches auth.users.id
  displayName: text('display_name'),
  email: text('email'),                                             // from Supabase JWT, used for friend search
  dailyGoal: smallint('daily_goal').notNull().default(20),
  notificationsEnabled: boolean('notifications_enabled').notNull().default(true),
  pushToken: text('push_token'),                                    // Expo push token
  timezone: text('timezone').notNull().default('UTC'),
  reminderHour: smallint('reminder_hour').notNull().default(20),   // 0-23, in user's timezone
  restDay: smallint('rest_day'),                                    // 0=Sun…6=Sat, null=no rest day
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── user_kanji_progress ──────────────────────────────────────────────────────

export const userKanjiProgress = pgTable(
  'user_kanji_progress',
  {
    id: serial('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    kanjiId: integer('kanji_id')
      .notNull()
      .references(() => kanji.id, { onDelete: 'cascade' }),
    status: srsStatusEnum('status').notNull().default('unseen'),
    readingStage: smallint('reading_stage').notNull().default(0), // 0–4
    easeFactor: real('ease_factor').notNull().default(2.5),
    interval: integer('interval').notNull().default(0), // days
    repetitions: integer('repetitions').notNull().default(0),
    nextReviewAt: timestamp('next_review_at', { withTimezone: true }),
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userKanjiUnique: uniqueIndex('user_kanji_unique_idx').on(t.userId, t.kanjiId),
    nextReviewIdx: index('user_kanji_next_review_idx').on(t.userId, t.nextReviewAt),
    statusIdx: index('user_kanji_status_idx').on(t.userId, t.status),
  })
)

// ─── review_sessions ──────────────────────────────────────────────────────────

export const reviewSessions = pgTable(
  'review_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    totalItems: integer('total_items').notNull().default(0),
    correctItems: integer('correct_items').notNull().default(0),
    studyTimeMs: integer('study_time_ms').notNull().default(0),
    sessionType: text('session_type').notNull().default('daily'), // daily | weekly | checkpoint | surprise | audit
  },
  (t) => ({
    userSessionIdx: index('review_session_user_idx').on(t.userId, t.startedAt),
  })
)

// ─── review_logs ──────────────────────────────────────────────────────────────

export const reviewLogs = pgTable(
  'review_logs',
  {
    id: serial('id').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => reviewSessions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    kanjiId: integer('kanji_id')
      .notNull()
      .references(() => kanji.id, { onDelete: 'cascade' }),
    reviewType: reviewTypeEnum('review_type').notNull(),
    quality: smallint('quality').notNull(), // 0–5 SM-2 quality
    responseTimeMs: integer('response_time_ms').notNull(),
    prevStatus: srsStatusEnum('prev_status').notNull(),
    nextStatus: srsStatusEnum('next_status').notNull(),
    prevInterval: integer('prev_interval').notNull(),
    nextInterval: integer('next_interval').notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userReviewIdx: index('review_log_user_idx').on(t.userId, t.reviewedAt),
    kanjiReviewIdx: index('review_log_kanji_idx').on(t.kanjiId, t.reviewedAt),
    sessionReviewIdx: index('review_log_session_idx').on(t.sessionId),
  })
)

// ─── mnemonics ────────────────────────────────────────────────────────────────

export const mnemonics = pgTable(
  'mnemonics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kanjiId: integer('kanji_id')
      .notNull()
      .references(() => kanji.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => userProfiles.id, { onDelete: 'cascade' }),
    type: mnemonicTypeEnum('type').notNull(), // 'system' | 'user'
    storyText: text('story_text').notNull(),
    imagePrompt: text('image_prompt'),
    imageUrl: text('image_url'),
    latitude: real('latitude'),
    longitude: real('longitude'),
    refreshPromptAt: timestamp('refresh_prompt_at', { withTimezone: true }), // 30-day nudge
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    kanjiMnemonicIdx: index('mnemonic_kanji_idx').on(t.kanjiId, t.type),
    userMnemonicIdx: index('mnemonic_user_idx').on(t.userId, t.kanjiId),
    refreshIdx: index('mnemonic_refresh_idx').on(t.refreshPromptAt),
  })
)

// ─── daily_stats ──────────────────────────────────────────────────────────────

export const dailyStats = pgTable(
  'daily_stats',
  {
    id: serial('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    date: text('date').notNull(), // YYYY-MM-DD
    reviewed: integer('reviewed').notNull().default(0),
    correct: integer('correct').notNull().default(0),
    newLearned: integer('new_learned').notNull().default(0),
    burned: integer('burned').notNull().default(0),
    studyTimeMs: integer('study_time_ms').notNull().default(0),
  },
  (t) => ({
    userDateUnique: uniqueIndex('daily_stats_user_date_idx').on(t.userId, t.date),
    userStatsIdx: index('daily_stats_user_idx').on(t.userId, t.date),
  })
)

// ─── interventions ────────────────────────────────────────────────────────────

export const interventions = pgTable(
  'interventions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    type: interventionTypeEnum('type').notNull(),
    triggeredAt: timestamp('triggered_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
  },
  (t) => ({
    userInterventionIdx: index('intervention_user_idx').on(t.userId, t.triggeredAt),
    unresolvedIdx: index('intervention_unresolved_idx').on(t.userId, t.resolvedAt),
  })
)

// ─── writing_attempts ─────────────────────────────────────────────────────────

export const writingAttempts = pgTable(
  'writing_attempts',
  {
    id: serial('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    kanjiId: integer('kanji_id')
      .notNull()
      .references(() => kanji.id, { onDelete: 'cascade' }),
    score: real('score').notNull(), // 0.0–1.0
    strokeCount: smallint('stroke_count').notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userWritingIdx: index('writing_attempt_user_idx').on(t.userId, t.attemptedAt),
  })
)

// ─── voice_attempts ───────────────────────────────────────────────────────────

export const voiceAttempts = pgTable(
  'voice_attempts',
  {
    id: serial('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    kanjiId: integer('kanji_id')
      .notNull()
      .references(() => kanji.id, { onDelete: 'cascade' }),
    transcript: text('transcript').notNull(),
    expected: text('expected').notNull(),
    distance: smallint('distance').notNull(), // Levenshtein distance
    passed: boolean('passed').notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userVoiceIdx: index('voice_attempt_user_idx').on(t.userId, t.attemptedAt),
  })
)

// ─── testSessions ─────────────────────────────────────────────────────────────
// Structured test events (exit quiz, weekly review, checkpoint, surprise, audit)

export const testSessions = pgTable(
  'kl_test_sessions',
  {
    id:            serial('test_session_id').primaryKey(),
    userId:        uuid('user_id')
                     .notNull()
                     .references(() => userProfiles.id, { onDelete: 'cascade' }),
    testType:      text('test_type').notNull(),
    // 'exit_quiz' | 'weekly_set' | 'level_checkpoint' | 'surprise_check' | 'monthly_audit'
    scopeLevel:    smallint('scope_level'),
    scopeKanjiIds: integer('scope_kanji_ids').array(),
    startedAt:     timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt:       timestamp('ended_at', { withTimezone: true }),
    totalItems:    integer('total_items'),
    correct:       integer('correct').notNull().default(0),
    scorePct:      numeric('score_pct', { precision: 5, scale: 2 }),
    passed:        boolean('passed'),
    voiceEnabled:  boolean('voice_enabled').notNull().default(false),
  },
  (t) => ({
    userTestIdx: index('test_session_user_idx').on(t.userId, t.startedAt),
    typeIdx:     index('test_session_type_idx').on(t.userId, t.testType),
  })
)

// ─── testResults ──────────────────────────────────────────────────────────────

export const testResults = pgTable(
  'kl_test_results',
  {
    id:              serial('result_id').primaryKey(),
    testSessionId:   integer('test_session_id')
                       .notNull()
                       .references(() => testSessions.id, { onDelete: 'cascade' }),
    userId:          uuid('user_id')
                       .notNull()
                       .references(() => userProfiles.id, { onDelete: 'cascade' }),
    kanjiId:         integer('kanji_id')
                       .notNull()
                       .references(() => kanji.id, { onDelete: 'cascade' }),
    questionType:    text('question_type').notNull(),
    // 'meaning_recall' | 'kunyomi_voice' | 'onyomi_voice' | 'onyomi_choice'
    // | 'write_from_meaning' | 'vocab_context' | 'compound_reading'
    correct:         boolean('correct').notNull(),
    responseMs:      integer('response_ms'),
    voiceTranscript: text('voice_transcript'),   // raw speech recogniser output
    normalizedInput: text('normalized_input'),   // after wanakana normalisation
    quality:         smallint('quality'),         // SM-2 0–5, fed back to SRS
    createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sessionResultIdx: index('test_result_session_idx').on(t.testSessionId),
    userResultIdx:    index('test_result_user_idx').on(t.userId, t.createdAt),
    kanjiResultIdx:   index('test_result_kanji_idx').on(t.kanjiId),
  })
)

// ─── friendships ─────────────────────────────────────────────────────────────

export const friendships = pgTable(
  'friendships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requesterId: uuid('requester_id').notNull().references(() => userProfiles.id, { onDelete: 'cascade' }),
    addresseeId: uuid('addressee_id').notNull().references(() => userProfiles.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'), // pending | accepted | declined
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniquePair: uniqueIndex('friendship_pair_idx').on(t.requesterId, t.addresseeId),
    addresseeIdx: index('friendship_addressee_idx').on(t.addresseeId),
    statusIdx: index('friendship_status_idx').on(t.requesterId, t.status),
  })
)

// ─── learner_profiles ─────────────────────────────────────────────────────────
// Extended preference and personality data for Kanji Buddy. One row per user.

export const learnerProfiles = pgTable('learner_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => userProfiles.id, { onDelete: 'cascade' }),
  nativeLanguage: text('native_language'),
  reasonsForLearning: jsonb('reasons_for_learning').$type<string[]>().notNull().default([]),
  interests: jsonb('interests').$type<string[]>().notNull().default([]),
  preferredMnemonicStyle: text('preferred_mnemonic_style'), // 'visual' | 'narrative' | 'wordplay' | 'spatial'
  preferredLearningStyles: jsonb('preferred_learning_styles').$type<string[]>().notNull().default([]),
  buddyPersonalityPref: buddyPersonalityEnum('buddy_personality_pref').notNull().default('encouraging'),
  studyEnvironments: jsonb('study_environments').$type<string[]>().notNull().default([]),
  goals: jsonb('goals').$type<string[]>().notNull().default([]),
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── learner_state_cache ──────────────────────────────────────────────────────
// Pre-computed snapshot of a learner's current state. Refreshed after each session.

export const learnerStateCache = pgTable(
  'learner_state_cache',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    currentStreakDays: integer('current_streak_days').notNull().default(0),
    longestStreakDays: integer('longest_streak_days').notNull().default(0),
    velocityTrend: velocityTrendEnum('velocity_trend').notNull().default('inactive'),
    totalKanjiSeen: integer('total_kanji_seen').notNull().default(0),
    totalKanjiBurned: integer('total_kanji_burned').notNull().default(0),
    activeLeechCount: integer('active_leech_count').notNull().default(0),
    leechKanjiIds: jsonb('leech_kanji_ids').$type<number[]>().notNull().default([]),
    weakestModality: weakestModalityEnum('weakest_modality').notNull().default('meaning'),
    strongestJlptLevel: jlptLevelEnum('strongest_jlpt_level'),
    currentFocusLevel: jlptLevelEnum('current_focus_level'),
    recentAccuracy: real('recent_accuracy').notNull().default(0),
    lastSessionAt: timestamp('last_session_at', { withTimezone: true }),
    avgDailyReviews: real('avg_daily_reviews').notNull().default(0),
    avgSessionDurationMs: integer('avg_session_duration_ms').notNull().default(0),
    daysSinceLastSession: integer('days_since_last_session').notNull().default(0),
    daysSinceFirstSession: integer('days_since_first_session').notNull().default(0),
    quizVsSrsGapHigh: boolean('quiz_vs_srs_gap_high').notNull().default(false),
    primaryDevice: deviceTypeEnum('primary_device'),
    deviceDistribution: jsonb('device_distribution')
      .$type<Partial<Record<'iphone' | 'ipad' | 'watch', number>>>()
      .notNull()
      .default({}),
    watchSessionAvgCards: integer('watch_session_avg_cards'),
    recentMilestones: jsonb('recent_milestones')
      .$type<{ type: string; achievedAt: string; payload: Record<string, unknown> }[]>()
      .notNull()
      .default([]),
    studyPatterns: jsonb('study_patterns')
      .$type<{
        preferredTime?: 'morning' | 'midday' | 'evening' | 'night'
        avgSessionsPerDay: number
        weekendVsWeekdayRatio: number
      }>()
      .notNull()
      .default({ avgSessionsPerDay: 0, weekendVsWeekdayRatio: 1 }),
    nextRecommendedActivity: text('next_recommended_activity'),
    buddyMood: buddyMoodEnum('buddy_mood').notNull().default('supportive'),
    // 'heavy' | 'medium' | 'light' — mirrors ScaffoldLevel in api/src/services/buddy/constants.ts
    scaffoldLevel: text('scaffold_level').notNull().default('medium'),
    friendsCount: integer('friends_count').notNull().default(0),
    activeFriendsToday: integer('active_friends_today').notNull().default(0),
    friendsAheadOnBurn: jsonb('friends_ahead_on_burn')
      .$type<{ friendId: string; displayName: string; metric: string; value: number; delta: number }[]>()
      .notNull()
      .default([]),
    friendsBehindOnBurn: jsonb('friends_behind_on_burn')
      .$type<{ friendId: string; displayName: string; metric: string; value: number; delta: number }[]>()
      .notNull()
      .default([]),
    friendsAheadOnStreak: jsonb('friends_ahead_on_streak')
      .$type<{ friendId: string; displayName: string; metric: string; value: number; delta: number }[]>()
      .notNull()
      .default([]),
    friendsBehindOnStreak: jsonb('friends_behind_on_streak')
      .$type<{ friendId: string; displayName: string; metric: string; value: number; delta: number }[]>()
      .notNull()
      .default([]),
    userStrengthsVsFriends: jsonb('user_strengths_vs_friends')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    groupMomentum: text('group_momentum'), // 'rising' | 'steady' | 'falling'
  }
)
// No secondary index: userId is PK, so all lookups are already point-lookups.
// If a cache-staleness job is added later, add `index(...).on(t.updatedAt)`.

// ─── buddy_conversations ──────────────────────────────────────────────────────
// Short-lived LLM conversation state. Expires 30min after last activity.

export const buddyConversations = pgTable(
  'buddy_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    context: text('context').notNull(), // 'session_start' | 'card_failed' | ...
    messages: jsonb('messages')
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default([]),
    turnCount: integer('turn_count').notNull().default(0),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userActiveIdx: index('buddy_conv_user_active_idx').on(t.userId, t.lastActiveAt),
  })
)

// ─── buddy_nudges ─────────────────────────────────────────────────────────────
// Pre-computed nudge messages for inline display on specific screens.

export const buddyNudges = pgTable(
  'buddy_nudges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    screen: text('screen').notNull(), // 'dashboard' | 'study' | 'journal' | 'write' | 'speak' | 'progress'
    nudgeType: text('nudge_type').notNull(),
    content: text('content').notNull(),
    watchSummary: text('watch_summary'),
    actionType: text('action_type'), // 'navigate' | 'start_drill' | 'view_kanji' | 'generate_mnemonic' | 'dismiss' | 'none'
    actionPayload: jsonb('action_payload').$type<Record<string, unknown>>(),
    priority: smallint('priority').notNull().default(3),
    deliveryTarget: text('delivery_target').notNull().default('app'),
    watchDeliveredAt: timestamp('watch_delivered_at', { withTimezone: true }),
    pushDeliveredAt: timestamp('push_delivered_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    generatedBy: text('generated_by').notNull(), // 'template' | 'on_device' | 'cloud'
    deviceType: deviceTypeEnum('device_type'),
    socialFraming: boolean('social_framing').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userScreenIdx: index('buddy_nudges_user_screen_idx').on(t.userId, t.screen, t.expiresAt),
    watchDeliveryIdx: index('buddy_nudges_watch_delivery_idx').on(t.userId, t.deliveryTarget, t.watchDeliveredAt),
  })
)

// ─── study_plans ──────────────────────────────────────────────────────────────

export const studyPlans = pgTable(
  'study_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    activities: jsonb('activities')
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default([]),
    rationale: text('rationale').notNull(),
    scaffoldLevel: smallint('scaffold_level').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    deviceType: deviceTypeEnum('device_type'),
    completedCount: integer('completed_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    userActiveIdx: index('study_plans_user_active_idx').on(t.userId, t.expiresAt),
  })
)

export const studyPlanEvents = pgTable(
  'study_plan_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => studyPlans.id, { onDelete: 'cascade' }),
    activityIndex: smallint('activity_index').notNull(),
    event: text('event').notNull(), // 'started' | 'completed' | 'skipped' | 'navigated_away'
    eventAt: timestamp('event_at', { withTimezone: true }).notNull().defaultNow(),
    deviceType: deviceTypeEnum('device_type'),
  },
  (t) => ({
    // Postgres does not auto-index FKs; "all events for plan X" is the core read.
    planIdx: index('study_plan_events_plan_idx').on(t.planId),
  })
)

// ─── study_log_entries ────────────────────────────────────────────────────────
// Enhanced journal entries with photos, sentences, audio, mood, tags.

export const studyLogEntries = pgTable(
  'study_log_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    kanjiId: integer('kanji_id')
      .notNull()
      .references(() => kanji.id, { onDelete: 'cascade' }),
    mnemonicId: uuid('mnemonic_id').references(() => mnemonics.id, { onDelete: 'set null' }),
    userNote: text('user_note'),
    exampleSentence: text('example_sentence'),
    sentenceReading: text('sentence_reading'),
    sentenceTranslation: text('sentence_translation'),
    photoUrls: jsonb('photo_urls').$type<string[]>().notNull().default([]),
    audioNoteUrl: text('audio_note_url'),
    locationLat: real('location_lat'),
    locationLng: real('location_lng'),
    locationName: text('location_name'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    mood: studyLogMoodEnum('mood'),
    sharedWithFriends: boolean('shared_with_friends').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
  },
  (t) => ({
    userCreatedIdx: index('study_log_user_created_idx').on(t.userId, t.createdAt),
    userKanjiIdx: index('study_log_user_kanji_idx').on(t.userId, t.kanjiId),
  })
)

// ─── shared_goals ─────────────────────────────────────────────────────────────

export const sharedGoals = pgTable(
  'shared_goals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userIdA: uuid('user_id_a')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    userIdB: uuid('user_id_b')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    goalType: text('goal_type').notNull(), // 'burn_milestone' | 'streak_match' | 'level_complete'
    target: integer('target').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    achievedAt: timestamp('achieved_at', { withTimezone: true }),
    achievedBy: jsonb('achieved_by').$type<Record<string, string>>().notNull().default({}),
  },
  (t) => ({
    pairTypeIdx: index('shared_goals_pair_type_idx').on(t.userIdA, t.userIdB, t.goalType),
  })
)

// ─── Universal Knowledge Graph ────────────────────────────────────────────────
// App-agnostic projection of learner state. Subjects are namespaced (e.g. "kanji:持").

export const learnerIdentity = pgTable('learner_identity', {
  // PK is named learnerId (not id) so every other UKG table can reference
  // `learnerIdentity.learnerId` with the same name they use for their own FK.
  learnerId: uuid('learner_id').primaryKey(), // matches user_profiles.id
  displayName: text('display_name'),
  email: text('email'),
  nativeLanguage: text('native_language'),
  targetLanguages: jsonb('target_languages').$type<string[]>().notNull().default(['ja']),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const learnerProfileUniversal = pgTable('learner_profile_universal', {
  learnerId: uuid('learner_id')
    .primaryKey()
    .references(() => learnerIdentity.learnerId, { onDelete: 'cascade' }),
  interests: jsonb('interests').$type<string[]>().notNull().default([]),
  reasonsForLearning: jsonb('reasons_for_learning').$type<string[]>().notNull().default([]),
  preferredLearningStyles: jsonb('preferred_learning_styles').$type<string[]>().notNull().default([]),
  goals: jsonb('goals').$type<string[]>().notNull().default([]),
  studyHabits: jsonb('study_habits').$type<Record<string, unknown>>().notNull().default({}),
  // buddyPersonalityEnum is Kanji-Buddy-specific vocabulary ('encouraging' | 'direct' | 'playful').
  // If a second app joins the UKG and needs a different vocabulary, relax this to plain text.
  buddyPersonalityPref: buddyPersonalityEnum('buddy_personality_pref').notNull().default('encouraging'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const learnerConnections = pgTable(
  'learner_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    learnerIdA: uuid('learner_id_a')
      .notNull()
      .references(() => learnerIdentity.learnerId, { onDelete: 'cascade' }),
    learnerIdB: uuid('learner_id_b')
      .notNull()
      .references(() => learnerIdentity.learnerId, { onDelete: 'cascade' }),
    relationship: text('relationship').notNull().default('friend'),
    sharedApps: jsonb('shared_apps').$type<string[]>().notNull().default(['kanji_buddy']),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Callers MUST normalize so learnerIdA < learnerIdB before insert; otherwise
    // (alice, bob) and (bob, alice) will both be accepted as distinct connections.
    pairIdx: uniqueIndex('learner_connections_pair_idx').on(t.learnerIdA, t.learnerIdB),
  })
)

export const learnerMemoryArtifacts = pgTable(
  'learner_memory_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    learnerId: uuid('learner_id')
      .notNull()
      .references(() => learnerIdentity.learnerId, { onDelete: 'cascade' }),
    subject: text('subject').notNull(), // e.g. "kanji:持"
    artifactType: text('artifact_type').notNull(), // 'mnemonic' | 'note' | 'sentence' | 'photo' | 'audio'
    content: jsonb('content').$type<Record<string, unknown>>().notNull(),
    context: jsonb('context').$type<Record<string, unknown>>().notNull().default({}),
    effectivenessScore: real('effectiveness_score').notNull().default(0.5),
    appSource: text('app_source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    subjectIdx: index('learner_artifacts_subject_idx').on(t.learnerId, t.subject),
  })
)

export const learnerKnowledgeState = pgTable(
  'learner_knowledge_state',
  {
    learnerId: uuid('learner_id')
      .notNull()
      .references(() => learnerIdentity.learnerId, { onDelete: 'cascade' }),
    subject: text('subject').notNull(),
    masteryLevel: real('mastery_level').notNull().default(0),
    status: text('status').notNull().default('unseen'), // 'unseen' | 'learning' | 'reviewing' | 'mastered'
    reviewCount: integer('review_count').notNull().default(0),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
    appSource: text('app_source').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.learnerId, t.subject] }),
    subjectOnlyIdx: index('learner_knowledge_subject_only_idx').on(t.subject),
  })
)

export const learnerAppGrants = pgTable(
  'learner_app_grants',
  {
    learnerId: uuid('learner_id')
      .notNull()
      .references(() => learnerIdentity.learnerId, { onDelete: 'cascade' }),
    appId: text('app_id').notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.learnerId, t.appId] }),
  })
)

export const learnerTimelineEvents = pgTable(
  'learner_timeline_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    learnerId: uuid('learner_id')
      .notNull()
      .references(() => learnerIdentity.learnerId, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    subject: text('subject'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    appSource: text('app_source').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    learnerTimeIdx: index('learner_timeline_learner_time_idx').on(t.learnerId, t.occurredAt),
  })
)

// ─── Relations ────────────────────────────────────────────────────────────────

export const kanjiRelations = relations(kanji, ({ many }) => ({
  progress: many(userKanjiProgress),
  mnemonics: many(mnemonics),
  reviewLogs: many(reviewLogs),
  writingAttempts: many(writingAttempts),
  voiceAttempts: many(voiceAttempts),
  testResults: many(testResults),
}))

export const userProfilesRelations = relations(userProfiles, ({ many }) => ({
  progress: many(userKanjiProgress),
  sessions: many(reviewSessions),
  reviewLogs: many(reviewLogs),
  mnemonics: many(mnemonics),
  dailyStats: many(dailyStats),
  interventions: many(interventions),
  writingAttempts: many(writingAttempts),
  voiceAttempts: many(voiceAttempts),
  testSessions: many(testSessions),
  testResults: many(testResults),
  sentRequests: many(friendships, { relationName: 'requester' }),
  receivedRequests: many(friendships, { relationName: 'addressee' }),
}))

export const friendshipsRelations = relations(friendships, ({ one }) => ({
  requester: one(userProfiles, { fields: [friendships.requesterId], references: [userProfiles.id], relationName: 'requester' }),
  addressee: one(userProfiles, { fields: [friendships.addresseeId], references: [userProfiles.id], relationName: 'addressee' }),
}))

export const userKanjiProgressRelations = relations(userKanjiProgress, ({ one }) => ({
  user: one(userProfiles, { fields: [userKanjiProgress.userId], references: [userProfiles.id] }),
  kanji: one(kanji, { fields: [userKanjiProgress.kanjiId], references: [kanji.id] }),
}))

export const reviewSessionsRelations = relations(reviewSessions, ({ one, many }) => ({
  user: one(userProfiles, { fields: [reviewSessions.userId], references: [userProfiles.id] }),
  logs: many(reviewLogs),
}))

export const reviewLogsRelations = relations(reviewLogs, ({ one }) => ({
  session: one(reviewSessions, { fields: [reviewLogs.sessionId], references: [reviewSessions.id] }),
  user: one(userProfiles, { fields: [reviewLogs.userId], references: [userProfiles.id] }),
  kanji: one(kanji, { fields: [reviewLogs.kanjiId], references: [kanji.id] }),
}))

export const mnemonicsRelations = relations(mnemonics, ({ one }) => ({
  kanji: one(kanji, { fields: [mnemonics.kanjiId], references: [kanji.id] }),
  user: one(userProfiles, { fields: [mnemonics.userId], references: [userProfiles.id] }),
}))

export const dailyStatsRelations = relations(dailyStats, ({ one }) => ({
  user: one(userProfiles, { fields: [dailyStats.userId], references: [userProfiles.id] }),
}))

export const interventionsRelations = relations(interventions, ({ one }) => ({
  user: one(userProfiles, { fields: [interventions.userId], references: [userProfiles.id] }),
}))

export const testSessionsRelations = relations(testSessions, ({ one, many }) => ({
  user: one(userProfiles, { fields: [testSessions.userId], references: [userProfiles.id] }),
  results: many(testResults),
}))

export const testResultsRelations = relations(testResults, ({ one }) => ({
  session: one(testSessions, { fields: [testResults.testSessionId], references: [testSessions.id] }),
  user: one(userProfiles, { fields: [testResults.userId], references: [userProfiles.id] }),
  kanji: one(kanji, { fields: [testResults.kanjiId], references: [kanji.id] }),
}))
