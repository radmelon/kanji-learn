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
