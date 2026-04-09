# Kanji Buddy: Technical Specification

**Version:** 2.0
**Date:** April 9, 2026
**Status:** Approved for implementation
**Companion document:** `2026-04-09-kanji-buddy-design.md`

This document is the technical reference for implementing Kanji Buddy. It is intended to be picked up when development begins. Read the companion design document first for context, philosophy, and rationale.

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [LLM Provider Layer](#2-llm-provider-layer)
3. [Buddy Agent](#3-buddy-agent)
4. [Database Schema](#4-database-schema)
5. [API Endpoints](#5-api-endpoints)
6. [Mobile App Integration](#6-mobile-app-integration)
7. [Apple Watch Integration](#7-apple-watch-integration)
8. [Study Orchestration Engine](#8-study-orchestration-engine)
9. [Contextual Mnemonic Co-Creation](#9-contextual-mnemonic-co-creation)
10. [Study Log](#10-study-log)
11. [Social Learning](#11-social-learning)
12. [Universal Knowledge Graph & MCP Server](#12-universal-knowledge-graph--mcp-server)
13. [Privacy & Security](#13-privacy--security)
14. [Implementation Phasing](#14-implementation-phasing)
15. [Testing Strategy](#15-testing-strategy)

---

## 1. System Architecture

### 1.1 High-Level Components

```
┌────────────────────────────────────────────────────────────────┐
│                    Mobile Apps (Expo / RN)                     │
│   iOS (iPhone, iPad)        Apple Watch        Android (later)  │
│                                                                 │
│   ┌──────────────────────────────────────────────────────┐    │
│   │  On-Device LLM Provider (when supported)              │    │
│   │  • iOS 26+: Apple Foundation Models                  │    │
│   │  • Android flagship: Gemini Nano (ML Kit GenAI)      │    │
│   │  • Older devices: skip Tier 1, route to cloud        │    │
│   └──────────────────────────────────────────────────────┘    │
│                                                                 │
│   ┌──────────────────────────────────────────────────────┐    │
│   │  BuddyCard Components (inline nudges)                │    │
│   │  Watch Complication (passive progress display)       │    │
│   │  Study Plan UI · Co-Creation Flow · Study Log        │    │
│   └──────────────────────────────────────────────────────┘    │
└──────────────────────────────┬─────────────────────────────────┘
                               │ HTTPS (existing API base)
                               ▼
┌────────────────────────────────────────────────────────────────┐
│                     Fastify API Server                          │
│                                                                 │
│   ┌──────────────────────────────────────────────────────┐    │
│   │  Existing services: SRS, mnemonics, analytics,       │    │
│   │  tests, social, placement, kanji, user               │    │
│   └──────────────────────────────────────────────────────┘    │
│                                                                 │
│   ┌──────────────────────────────────────────────────────┐    │
│   │  NEW: Buddy Services                                  │    │
│   │  • BuddyAgent (LLM-powered reasoning)                │    │
│   │  • BuddyNudgeService (template + LLM nudges)         │    │
│   │  • StudyPlanEngine (rule-based prescriptions)        │    │
│   │  • LearnerStateService (cache management)            │    │
│   │  • CoCreationService (mnemonic flow orchestration)   │    │
│   │  • SocialNudgeService (peer comparison logic)        │    │
│   │  • LLMRouter (provider abstraction)                  │    │
│   └──────────────────────────────────────────────────────┘    │
│                                                                 │
│   ┌──────────────────────────────────────────────────────┐    │
│   │  NEW: MCP Server (internal in Phase 8)                │    │
│   │  Tools · Resources · Prompts                          │    │
│   └──────────────────────────────────────────────────────┘    │
└──────────────────────────────┬─────────────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
   ┌──────────────┐  ┌─────────────────┐  ┌──────────────┐
   │ PostgreSQL   │  │ Free Cloud LLMs │  │ Premium LLMs │
   │ (Supabase)   │  │ • Groq          │  │ • Claude     │
   │              │  │ • Gemini Flash  │  │   (opt-in)   │
   │ App schema + │  │                 │  │              │
   │ Universal KG │  │ (Tier 2)        │  │ (Tier 3)     │
   └──────────────┘  └─────────────────┘  └──────────────┘
```

### 1.2 Repository Structure

Kanji Buddy is **version 2 of Kanji Learn** — same monorepo, additive changes. No greenfield rewrite.

```
kanji-learn/                              (repo stays kanji-learn for now)
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── ... (existing)
│   │   │   │   ├── buddy.ts                 NEW
│   │   │   │   ├── buddy-nudges.ts          NEW
│   │   │   │   ├── study-plans.ts           NEW
│   │   │   │   ├── cocreation.ts            NEW
│   │   │   │   ├── study-log.ts             NEW
│   │   │   │   └── mcp.ts                   NEW (Phase 8)
│   │   │   ├── services/
│   │   │   │   ├── ... (existing)
│   │   │   │   ├── buddy/
│   │   │   │   │   ├── agent.ts             NEW
│   │   │   │   │   ├── nudge.service.ts     NEW
│   │   │   │   │   ├── study-plan.engine.ts NEW
│   │   │   │   │   ├── cocreation.service.ts NEW
│   │   │   │   │   ├── learner-state.service.ts NEW
│   │   │   │   │   ├── social-nudge.service.ts NEW
│   │   │   │   │   └── prompts/             NEW (system prompts, templates)
│   │   │   │   ├── llm/
│   │   │   │   │   ├── router.ts            NEW
│   │   │   │   │   ├── providers/
│   │   │   │   │   │   ├── apple-foundation.ts NEW (server stub for testing)
│   │   │   │   │   │   ├── groq.ts          NEW
│   │   │   │   │   │   ├── gemini.ts        NEW
│   │   │   │   │   │   └── claude.ts        EXISTING (refactor to provider interface)
│   │   │   │   │   └── types.ts             NEW
│   │   │   │   └── mcp/
│   │   │   │       ├── server.ts            NEW (Phase 8)
│   │   │   │       ├── tools/               NEW
│   │   │   │       └── resources/           NEW
│   │   │   └── ...
│   │   └── ...
│   ├── mobile/
│   │   ├── app/
│   │   │   ├── (tabs)/
│   │   │   │   ├── ... (existing)
│   │   │   │   └── journal.tsx              MODIFY (Study Log)
│   │   │   └── (buddy)/                     NEW
│   │   │       ├── cocreation.tsx           NEW
│   │   │       ├── study-plan.tsx           NEW
│   │   │       └── onboarding/              NEW (Phase 7)
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── ... (existing)
│   │   │   │   ├── BuddyCard.tsx            NEW
│   │   │   │   ├── StudyPlanList.tsx        NEW
│   │   │   │   ├── CoCreationStage.tsx      NEW
│   │   │   │   ├── StudyLogEntry.tsx        NEW
│   │   │   │   └── StudyLogMapView.tsx      NEW
│   │   │   ├── services/
│   │   │   │   ├── llm/
│   │   │   │   │   ├── client-router.ts     NEW
│   │   │   │   │   └── apple-fm-bridge.ts   NEW
│   │   │   │   └── buddy-client.ts          NEW
│   │   │   └── stores/
│   │   │       ├── ... (existing)
│   │   │       ├── buddy.store.ts           NEW
│   │   │       └── study-plan.store.ts      NEW
│   │   └── ...
│   └── watch/
│       └── ... (existing, with new complication views)
├── packages/
│   ├── db/
│   │   └── src/
│   │       ├── schema.ts                    MODIFY (add new tables)
│   │       └── ...
│   └── shared/
│       └── src/
│           ├── types.ts                     MODIFY (add Buddy types)
│           ├── buddy-types.ts               NEW
│           └── ...
└── docs/
    └── superpowers/
        └── specs/
            ├── 2026-04-09-kanji-buddy-design.md
            └── 2026-04-09-kanji-buddy-spec.md  (this file)
```

### 1.3 Technology Stack Additions

| Component | Technology | Notes |
|-----------|------------|-------|
| On-device LLM (iOS) | Apple Foundation Models | Via `@react-native-ai/apple` or `expo-apple-intelligence`. iOS 26+ |
| On-device LLM (Android) | Gemini Nano via ML Kit GenAI | Phase 10. May require custom native module |
| Free cloud LLM | Groq SDK (`groq-sdk`) | Llama 3.3 70B primary |
| Free cloud LLM fallback | Google Gemini API | Gemini 2.5 Flash free tier |
| Premium LLM | Anthropic SDK | Existing, refactored as provider |
| Reverse geocoding | OpenStreetMap Nominatim | Free, no API key, rate limited |
| MCP server | Custom Fastify plugin | Implements MCP standard |
| Photo storage | Supabase Storage | Existing infra |
| Push notifications | Expo push (existing) | Watch nudges via WatchConnectivity |

---

## 2. LLM Provider Layer

### 2.1 Provider Interface

```typescript
// packages/shared/src/llm-types.ts

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: JSONSchema
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResult {
  toolCallId: string
  content: string | Record<string, unknown>
  isError?: boolean
}

export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolResults: ToolResult[] }

export interface CompletionRequest {
  systemPrompt?: string
  messages: Message[]
  tools?: ToolDefinition[]
  maxTokens: number
  temperature: number
  responseFormat?: 'text' | 'json'
}

export interface CompletionResult {
  content: string
  toolCalls?: ToolCall[]
  finishReason: 'stop' | 'length' | 'tool_use' | 'safety'
  inputTokens: number
  outputTokens: number
  providerName: string
  latencyMs: number
}

export interface LLMProvider {
  readonly name: string
  readonly supportsToolCalling: boolean
  readonly maxContextTokens: number
  readonly estimatedLatencyMs: number
  readonly costPerInputToken: number   // 0 for free providers
  readonly costPerOutputToken: number  // 0 for free providers

  generateCompletion(request: CompletionRequest): Promise<CompletionResult>
  isAvailable(): Promise<boolean>
}
```

### 2.2 Provider Implementations

**`AppleFoundationProvider`** (client-side only, mobile app)
- Bridges to `@react-native-ai/apple` or chosen package
- `maxContextTokens: 4096`
- `supportsToolCalling: true` (via @Generable Swift macros)
- `isAvailable()` checks: iOS 26+, Apple Intelligence enabled, device class
- On unavailable, router falls through to next tier

**`GroqProvider`** (server-side)
- Uses `groq-sdk` npm package
- Default model: `llama-3.3-70b-versatile`
- `maxContextTokens: 128_000`
- `supportsToolCalling: true`
- Rate limit handling: 30 RPM, 14,400 RPD per IP
- Implement exponential backoff on 429
- Track per-user request count to enforce per-user caps

**`GeminiProvider`** (server-side, fallback to Groq)
- Uses `@google/generative-ai`
- Default model: `gemini-2.5-flash`
- `maxContextTokens: 1_048_576`
- `supportsToolCalling: true`
- Rate limit: 10 RPM, 250 RPD
- Used as fallback when Groq is rate-limited or unavailable

**`ClaudeProvider`** (server-side, premium tier, optional)
- Uses existing Anthropic SDK setup
- Default model: `claude-sonnet-4-6` (current production model)
- `maxContextTokens: 200_000`
- Only invoked when explicit opt-in
- Hard daily cap per user (default: 2 calls/day)

### 2.3 LLM Router

```typescript
// apps/api/src/services/llm/router.ts

export type RequestContext =
  | 'encouragement'
  | 'streak_message'
  | 'milestone_celebration'
  | 'session_summary'
  | 'study_plan_generation'
  | 'leech_diagnostic'
  | 'mnemonic_question_generation'
  | 'mnemonic_assembly'
  | 'mnemonic_cocreation'
  | 'deep_diagnostic'
  | 'social_nudge'

export interface BuddyRequest {
  context: RequestContext
  userId: string
  systemPrompt: string
  messages: Message[]
  tools?: ToolDefinition[]
  preferredTier?: 1 | 2 | 3
  userOptedInPremium?: boolean
}

export class BuddyLLMRouter {
  constructor(
    private providers: {
      onDevice?: LLMProvider     // Set on client only
      tier2Primary: LLMProvider  // Groq
      tier2Fallback: LLMProvider // Gemini
      tier3Premium?: LLMProvider // Claude
    }
  ) {}

  async route(request: BuddyRequest): Promise<CompletionResult> {
    const tier = this.classifyTier(request)

    // Tier 1: On-device (mobile app only)
    if (tier === 1 && this.providers.onDevice) {
      try {
        return await this.providers.onDevice.generateCompletion(
          this.truncateForContext(request, 4096)
        )
      } catch (e) {
        // Fall through to Tier 2
      }
    }

    // Tier 3: Premium (only if user opted in and provider configured)
    if (tier === 3 && request.userOptedInPremium && this.providers.tier3Premium) {
      try {
        return await this.providers.tier3Premium.generateCompletion(request)
      } catch (e) {
        // Fall through to Tier 2
      }
    }

    // Tier 2: Free cloud with primary→fallback
    return this.withFailover(
      [this.providers.tier2Primary, this.providers.tier2Fallback],
      request
    )
  }

  private classifyTier(request: BuddyRequest): 1 | 2 | 3 {
    // Tier 1: Templatable, simple language tasks
    const tier1Contexts: RequestContext[] = [
      'encouragement', 'streak_message', 'milestone_celebration', 'session_summary'
    ]
    if (tier1Contexts.includes(request.context)) return 1

    // Tier 3: Complex creative/reasoning
    const tier3Contexts: RequestContext[] = [
      'mnemonic_cocreation', 'deep_diagnostic'
    ]
    if (tier3Contexts.includes(request.context)) return 3

    // Tier 2: Default
    return 2
  }

  private async withFailover(
    providers: LLMProvider[],
    request: BuddyRequest
  ): Promise<CompletionResult> {
    let lastError: unknown
    for (const provider of providers) {
      try {
        if (await provider.isAvailable()) {
          return await provider.generateCompletion(request)
        }
      } catch (e) {
        lastError = e
        continue
      }
    }
    throw new BuddyLLMError('All providers failed', lastError)
  }

  private truncateForContext(
    request: BuddyRequest,
    maxTokens: number
  ): BuddyRequest {
    // Summarize older messages, keep the latest N
    // Implementation detail: see truncation strategy in §3.4
    return /* truncated request */
  }
}
```

### 2.4 Per-User Rate Limiting

To prevent abuse and protect free-tier quotas, the router enforces per-user limits:

```
per-user daily limits:
├── Tier 1 (on-device): unlimited
├── Tier 2 (Groq/Gemini): 50 calls/day
├── Tier 3 (Claude): 2 calls/day (configurable)

per-user limit storage:
├── Redis or PostgreSQL counter
├── Reset at midnight in user's timezone
├── Hit limit → return graceful degradation message
```

When a user hits Tier 2 daily limit, the response is:

> "I'm running low on creative energy today. Let's save this for tomorrow — I want to give you a really good answer."

This both protects quotas and creates anticipation.

---

## 3. Buddy Agent

### 3.1 Agent Responsibilities

The Buddy Agent is the **server-side reasoning engine**. It:
1. Receives event triggers (session completed, card failed, app opened, etc.)
2. Loads learner context
3. Constructs system prompt with learner profile
4. Calls the LLM Router with available tools
5. Executes tool calls (database queries, mnemonic generation, etc.)
6. Persists results (nudges, mnemonics, plan updates)
7. Returns response to client

### 3.2 System Prompt Template

```typescript
// apps/api/src/services/buddy/prompts/system-prompt.ts

export function buildBuddySystemPrompt(profile: LearnerProfile, state: LearnerStateCache): string {
  return `You are Kanji Buddy — a warm, knowledgeable Japanese language learning
companion. You are not a teacher lecturing from a podium. You are a friend
sitting beside the learner, studying together.

CORE PRINCIPLES:
1. CONSTRUCTIVIST: Learning is connecting new knowledge to existing experience.
   Always seek what the learner already knows and build bridges from there.
   Never present kanji as abstract symbols to memorize — connect them to the
   learner's world.

2. SCAFFOLDING: Provide the right level of support, then fade it. New learners
   get more structure and guidance. As mastery grows, shift to challenges and
   autonomy. Never create dependency.

3. HONEST ENCOURAGEMENT: Celebrate genuine progress, not effort theater. "You
   burned 5 kanji this week" is better than "Great job studying!" Acknowledge
   difficulty without minimizing it.

4. DATA-INFORMED: You have access to detailed performance data. Use it to give
   specific, actionable guidance — not generic advice. "Your reading accuracy
   on N4 kanji dropped to 58% this week" is better than "Keep practicing
   readings!"

PERSONALITY:
- Tone: ${profile.buddyPersonalityPref} (encouraging | direct | playful)
- Concise. Mobile screen. 2-3 sentences max for nudges.
- Use the learner's name occasionally.
- Reference shared history when relevant.

LEARNER CONTEXT:
- Name: ${profile.displayName}
- Studying since: ${profile.createdAt}
- Native language: ${profile.nativeLanguage || 'unknown'}
- Reasons for learning: ${profile.reasonsForLearning.join(', ') || 'unknown'}
- Interests: ${profile.interests.join(', ') || 'unknown'}
- Preferred mnemonic style: ${profile.preferredMnemonicStyle || 'unknown'}

CURRENT STATE:
- Streak: ${state.currentStreak} days
- Total seen: ${state.totalSeen} / Total burned: ${state.totalBurned}
- Velocity trend: ${state.velocityTrend}
- Active leeches: ${state.activeLeeches}
- Weakest modality: ${state.weakestModality}
- Days since last session: ${state.daysSinceLastSession}
- Buddy mood: ${state.buddyMood}
- Scaffold level: ${state.scaffoldLevel}

YOU MUST NOT:
- Give incorrect kanji information (readings, meanings, stroke order)
- Overwhelm with too many suggestions at once
- Be condescending about failures
- Generate content unrelated to Japanese learning
- Lead social comparisons with negative framing
- Reveal a friend's private failure data

When asked, use the available tools to gather more specific information about
the learner's history, current state, or kanji mastery before responding.`
}
```

### 3.3 Agent Tools

| Tool Name | Type | Description |
|-----------|------|-------------|
| `query_learner_state` | Read | Returns the latest LearnerStateCache snapshot |
| `get_kanji_mastery` | Read | Deep dive on a specific kanji's mastery data |
| `find_confused_pairs` | Read | Detects visually/semantically similar kanji the user confuses |
| `get_session_history` | Read | Recent study sessions with summaries |
| `get_location_context` | Read | Reverse-geocodes lat/lng to place name and type |
| `get_friend_activity` | Read | Friends' recent activity, leaderboard position |
| `generate_mnemonic` | Write | Creates a personalized mnemonic given context |
| `save_mnemonic` | Write | Persists a mnemonic with metadata |
| `prescribe_activity` | Write | Creates a Buddy nudge prescribing an activity |
| `schedule_review` | Write | Injects specific kanji into next review queue |

Tool input/output schemas live in `apps/api/src/services/buddy/tools/schemas.ts`.

### 3.4 Conversation Management

```sql
CREATE TABLE buddy_conversations (
  id            UUID PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES user_profiles(id),
  context       TEXT NOT NULL,  -- enum: session_start, card_failed, etc.
  messages      JSONB NOT NULL DEFAULT '[]',
  turn_count    INTEGER NOT NULL DEFAULT 0,
  last_active_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_buddy_conv_user_active
  ON buddy_conversations(user_id, last_active_at DESC)
  WHERE expires_at > NOW();
```

**Lifecycle:**
- New conversation per context (session_start, card_failed, etc.)
- Expires 30 minutes after `last_active_at`
- Apple Foundation Models 4K context limit handled by truncation:
  - Always keep system prompt (~500 tokens)
  - Always keep latest 3 messages
  - Summarize older messages into a single "Previous context" message if approaching limit
- Tool calls and results are stored in `messages` array as separate entries

### 3.5 Trigger Events

| Trigger | Source | Sync/Async | Action |
|---------|--------|------------|--------|
| `session_completed` | Review submit endpoint | Async | Update state cache, generate next-visit nudges |
| `card_failed` (≥3x) | Review log analysis | Async | Pre-screen for leech, queue mnemonic regen offer |
| `app_opened` | Mobile app | Sync | Serve pre-computed nudges, check streak |
| `idle_48h` | Cron job | Async | Generate push notification text |
| `milestone_reached` | State cache update | Async | Generate celebration nudge |
| `quiz_completed` | Quiz submit endpoint | Async | Analyze gaps, prescribe activities |
| `user_taps_buddy` | Mobile UI | Sync | Open interactive session |
| `mnemonic_failed` (3x with same mnemonic) | Review log analysis | Async | Trigger co-creation offer |

Async triggers are handled via a job queue (existing infra or new lightweight queue using Postgres).

---

## 4. Database Schema

### 4.1 New Tables

```sql
-- ============================================================
-- Learner profile enrichment
-- ============================================================
CREATE TABLE learner_profiles (
  user_id                  UUID PRIMARY KEY REFERENCES user_profiles(id),
  native_language          TEXT,
  reasons_for_learning     JSONB NOT NULL DEFAULT '[]',
  interests                JSONB NOT NULL DEFAULT '[]',
  preferred_mnemonic_style TEXT CHECK (preferred_mnemonic_style IN
    ('visual', 'narrative', 'wordplay', 'spatial')),
  preferred_learning_styles JSONB NOT NULL DEFAULT '[]',
  buddy_personality_pref   TEXT NOT NULL DEFAULT 'encouraging'
    CHECK (buddy_personality_pref IN ('encouraging', 'direct', 'playful')),
  study_environments       JSONB NOT NULL DEFAULT '[]',
  goals                    JSONB NOT NULL DEFAULT '[]',
  onboarding_completed_at  TIMESTAMP WITH TIME ZONE,
  created_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Learner state cache (pre-computed snapshot)
-- ============================================================
CREATE TABLE learner_state_cache (
  user_id                   UUID PRIMARY KEY REFERENCES user_profiles(id),
  computed_at               TIMESTAMP WITH TIME ZONE NOT NULL,
  current_streak            INTEGER NOT NULL DEFAULT 0,
  velocity_trend            TEXT NOT NULL DEFAULT 'inactive'
    CHECK (velocity_trend IN ('accelerating', 'steady', 'decelerating', 'inactive')),
  total_seen                INTEGER NOT NULL DEFAULT 0,
  total_burned              INTEGER NOT NULL DEFAULT 0,
  active_leeches            INTEGER NOT NULL DEFAULT 0,
  leech_kanji_ids           INTEGER[] NOT NULL DEFAULT '{}',
  weakest_modality          TEXT
    CHECK (weakest_modality IN ('meaning', 'reading', 'writing', 'voice', 'compound')),
  strongest_jlpt_level      TEXT,
  current_focus_level       TEXT,
  avg_daily_reviews         REAL NOT NULL DEFAULT 0,
  avg_session_duration_ms   INTEGER NOT NULL DEFAULT 0,
  days_since_last_session   INTEGER NOT NULL DEFAULT 0,
  quiz_vs_srs_gap_high      BOOLEAN NOT NULL DEFAULT FALSE,
  primary_device            TEXT
    CHECK (primary_device IN ('iphone', 'ipad', 'watch')),
  device_distribution       JSONB NOT NULL DEFAULT '{}',
  watch_session_avg_cards   INTEGER,
  recent_milestones         JSONB NOT NULL DEFAULT '[]',
  study_patterns            JSONB NOT NULL DEFAULT '{}',
  next_recommended_activity TEXT,
  buddy_mood                TEXT NOT NULL DEFAULT 'supportive'
    CHECK (buddy_mood IN ('celebratory', 'supportive', 'challenging', 'concerned')),
  scaffold_level            SMALLINT NOT NULL DEFAULT 1
    CHECK (scaffold_level BETWEEN 1 AND 3),
  friends_count             INTEGER NOT NULL DEFAULT 0,
  active_friends_today      INTEGER NOT NULL DEFAULT 0,
  friends_ahead_on_burn     JSONB NOT NULL DEFAULT '[]',
  friends_behind_on_burn    JSONB NOT NULL DEFAULT '[]',
  friends_ahead_on_streak   JSONB NOT NULL DEFAULT '[]',
  friends_behind_on_streak  JSONB NOT NULL DEFAULT '[]',
  user_strengths_vs_friends JSONB NOT NULL DEFAULT '{}',
  group_momentum            TEXT
    CHECK (group_momentum IN ('rising', 'steady', 'falling'))
);

CREATE INDEX idx_learner_state_computed
  ON learner_state_cache(user_id, computed_at);

-- ============================================================
-- Buddy conversations
-- ============================================================
CREATE TABLE buddy_conversations (
  id             UUID PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES user_profiles(id),
  context        TEXT NOT NULL,
  messages       JSONB NOT NULL DEFAULT '[]',
  turn_count     INTEGER NOT NULL DEFAULT 0,
  last_active_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_buddy_conv_user_active
  ON buddy_conversations(user_id, last_active_at DESC)
  WHERE expires_at > NOW();

-- ============================================================
-- Buddy nudges (pre-computed messages)
-- ============================================================
CREATE TABLE buddy_nudges (
  id                  UUID PRIMARY KEY,
  user_id             UUID NOT NULL REFERENCES user_profiles(id),
  screen              TEXT NOT NULL
    CHECK (screen IN ('dashboard', 'study', 'journal', 'write', 'speak', 'progress')),
  nudge_type          TEXT NOT NULL,
  content             TEXT NOT NULL,
  watch_summary       TEXT,  -- ≤60 chars
  action_type         TEXT
    CHECK (action_type IN ('navigate', 'start_drill', 'view_kanji',
                           'generate_mnemonic', 'dismiss', 'none')),
  action_payload      JSONB,
  priority            SMALLINT NOT NULL DEFAULT 3
    CHECK (priority BETWEEN 1 AND 5),
  delivery_target     TEXT NOT NULL DEFAULT 'app'
    CHECK (delivery_target IN ('app', 'watch', 'push', 'all')),
  watch_delivered_at  TIMESTAMP WITH TIME ZONE,
  push_delivered_at   TIMESTAMP WITH TIME ZONE,
  expires_at          TIMESTAMP WITH TIME ZONE NOT NULL,
  dismissed_at        TIMESTAMP WITH TIME ZONE,
  generated_by        TEXT NOT NULL
    CHECK (generated_by IN ('template', 'on_device', 'cloud')),
  device_type         TEXT
    CHECK (device_type IN ('iphone', 'ipad', 'watch')),
  social_framing      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_buddy_nudges_user_screen
  ON buddy_nudges(user_id, screen, expires_at)
  WHERE dismissed_at IS NULL;

CREATE INDEX idx_buddy_nudges_watch_delivery
  ON buddy_nudges(user_id, delivery_target, watch_delivered_at)
  WHERE delivery_target IN ('watch', 'all');

-- ============================================================
-- Study plans
-- ============================================================
CREATE TABLE study_plans (
  id              UUID PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES user_profiles(id),
  activities      JSONB NOT NULL,  -- StudyActivity[]
  rationale       TEXT NOT NULL,
  scaffold_level  SMALLINT NOT NULL,
  generated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  device_type     TEXT,
  completed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count   INTEGER NOT NULL DEFAULT 0,
  expires_at      TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX idx_study_plans_user_active
  ON study_plans(user_id, expires_at)
  WHERE expires_at > NOW();

CREATE TABLE study_plan_events (
  id              UUID PRIMARY KEY,
  plan_id         UUID NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
  activity_index  SMALLINT NOT NULL,
  event           TEXT NOT NULL
    CHECK (event IN ('started', 'completed', 'skipped', 'navigated_away')),
  event_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  device_type     TEXT
);

-- ============================================================
-- Study log entries (enhanced journal)
-- ============================================================
CREATE TABLE study_log_entries (
  id                   UUID PRIMARY KEY,
  user_id              UUID NOT NULL REFERENCES user_profiles(id),
  kanji_id             INTEGER NOT NULL REFERENCES kanji(id),
  mnemonic_id          UUID REFERENCES mnemonics(id),
  user_note            TEXT,
  example_sentence     TEXT,
  sentence_reading     TEXT,
  sentence_translation TEXT,
  photo_urls           JSONB NOT NULL DEFAULT '[]',
  audio_note_url       TEXT,
  location_lat         REAL,  -- rounded to 3 decimals
  location_lng         REAL,
  location_name        TEXT,
  tags                 JSONB NOT NULL DEFAULT '[]',
  mood                 TEXT
    CHECK (mood IN ('aha', 'struggle', 'breakthrough', 'fun', 'confused')),
  shared_with_friends  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_viewed_at       TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_study_log_user_created
  ON study_log_entries(user_id, created_at DESC);

CREATE INDEX idx_study_log_user_tags
  ON study_log_entries USING GIN (tags);

CREATE INDEX idx_study_log_user_kanji
  ON study_log_entries(user_id, kanji_id);

-- ============================================================
-- Shared goals (social)
-- ============================================================
CREATE TABLE shared_goals (
  id          UUID PRIMARY KEY,
  user_id_a   UUID NOT NULL REFERENCES user_profiles(id),
  user_id_b   UUID NOT NULL REFERENCES user_profiles(id),
  goal_type   TEXT NOT NULL
    CHECK (goal_type IN ('burn_milestone', 'streak_match', 'level_complete')),
  target      INTEGER NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  achieved_at TIMESTAMP WITH TIME ZONE,
  achieved_by JSONB NOT NULL DEFAULT '{}',
  CHECK (user_id_a < user_id_b)  -- enforce ordering for uniqueness
);

CREATE UNIQUE INDEX idx_shared_goals_pair_type
  ON shared_goals(user_id_a, user_id_b, goal_type, target)
  WHERE achieved_at IS NULL;

-- ============================================================
-- Universal Knowledge Graph (Phase 0/8)
-- ============================================================
CREATE TABLE learner_identity (
  id                UUID PRIMARY KEY,  -- same as auth.users.id
  display_name      TEXT,
  email             TEXT,
  native_language   TEXT,
  target_languages  JSONB NOT NULL DEFAULT '["ja"]',
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE learner_profile_universal (
  learner_id              UUID PRIMARY KEY REFERENCES learner_identity(id),
  interests               JSONB NOT NULL DEFAULT '[]',
  reasons_for_learning    JSONB NOT NULL DEFAULT '[]',
  preferred_learning_styles JSONB NOT NULL DEFAULT '[]',
  goals                   JSONB NOT NULL DEFAULT '[]',
  study_habits            JSONB NOT NULL DEFAULT '{}',
  buddy_personality_pref  TEXT NOT NULL DEFAULT 'encouraging',
  updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE learner_connections (
  id            UUID PRIMARY KEY,
  learner_id_a  UUID NOT NULL REFERENCES learner_identity(id),
  learner_id_b  UUID NOT NULL REFERENCES learner_identity(id),
  relationship  TEXT NOT NULL DEFAULT 'friend'
    CHECK (relationship IN ('friend', 'study_partner', 'mentor')),
  shared_apps   JSONB NOT NULL DEFAULT '["kanji_buddy"]',
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CHECK (learner_id_a < learner_id_b)
);

CREATE UNIQUE INDEX idx_learner_connections_pair
  ON learner_connections(learner_id_a, learner_id_b);

CREATE TABLE learner_memory_artifacts (
  id                  UUID PRIMARY KEY,
  learner_id          UUID NOT NULL REFERENCES learner_identity(id),
  subject             TEXT NOT NULL,  -- namespaced: "kanji:持"
  artifact_type       TEXT NOT NULL
    CHECK (artifact_type IN ('mnemonic', 'note', 'sentence', 'photo', 'audio')),
  content             JSONB NOT NULL,
  context             JSONB NOT NULL DEFAULT '{}',
  effectiveness_score REAL NOT NULL DEFAULT 0.5,
  source_app          TEXT NOT NULL,
  created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_learner_artifacts_subject
  ON learner_memory_artifacts(learner_id, subject);

CREATE TABLE learner_knowledge_state (
  learner_id         UUID NOT NULL REFERENCES learner_identity(id),
  subject            TEXT NOT NULL,
  mastery_level      REAL NOT NULL DEFAULT 0.0
    CHECK (mastery_level BETWEEN 0.0 AND 1.0),
  status             TEXT NOT NULL DEFAULT 'unseen'
    CHECK (status IN ('unseen', 'learning', 'reviewing', 'mastered')),
  first_seen_at      TIMESTAMP WITH TIME ZONE,
  last_reinforced_at TIMESTAMP WITH TIME ZONE,
  source_app         TEXT NOT NULL,
  metadata           JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (learner_id, subject)
);

-- Note: PRIMARY KEY (learner_id, subject) auto-creates the lookup index.
-- An additional index on subject alone supports cross-learner queries
-- (e.g. "who else has mastered kanji:持") that the MCP layer may surface.
CREATE INDEX idx_learner_knowledge_subject_only
  ON learner_knowledge_state(subject);

CREATE TABLE learner_app_grants (
  learner_id        UUID NOT NULL REFERENCES learner_identity(id),
  app_id            TEXT NOT NULL,
  scopes            JSONB NOT NULL DEFAULT '[]',
  granted_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  revoked_at        TIMESTAMP WITH TIME ZONE,
  last_accessed_at  TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY (learner_id, app_id)
);

CREATE TABLE learner_timeline_events (
  id          UUID PRIMARY KEY,
  learner_id  UUID NOT NULL REFERENCES learner_identity(id),
  event_type  TEXT NOT NULL,
  subject     TEXT,
  payload     JSONB NOT NULL DEFAULT '{}',
  source_app  TEXT NOT NULL,
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_learner_timeline_learner_time
  ON learner_timeline_events(learner_id, occurred_at DESC);
```

### 4.2 Modifications to Existing Tables

```sql
-- review_sessions
ALTER TABLE review_sessions
  ADD COLUMN device_type TEXT
  CHECK (device_type IN ('iphone', 'ipad', 'watch'));

-- review_logs
ALTER TABLE review_logs
  ADD COLUMN device_type TEXT
  CHECK (device_type IN ('iphone', 'ipad', 'watch'));

-- test_sessions
ALTER TABLE test_sessions
  ADD COLUMN device_type TEXT
  CHECK (device_type IN ('iphone', 'ipad', 'watch'));

-- mnemonics
ALTER TABLE mnemonics
  ADD COLUMN generation_method TEXT NOT NULL DEFAULT 'system'
    CHECK (generation_method IN ('system', 'user', 'cocreated')),
  ADD COLUMN location_type TEXT,
  ADD COLUMN cocreation_context JSONB,
  ADD COLUMN effectiveness_score REAL NOT NULL DEFAULT 0.5
    CHECK (effectiveness_score BETWEEN 0.0 AND 1.0),
  ADD COLUMN last_reinforced_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN reinforcement_count INTEGER NOT NULL DEFAULT 0;

-- interventions: add new enum values
-- (in Drizzle, this is a schema update; in raw SQL it's an enum alteration)
-- New types: 'friend_rescue_opportunity', 'group_momentum_shift'

-- user_profiles
ALTER TABLE user_profiles
  ADD COLUMN onboarding_completed_at TIMESTAMP WITH TIME ZONE;
```

### 4.3 Materialized View

```sql
CREATE MATERIALIZED VIEW kanji_mastery_view AS
SELECT
  p.user_id,
  p.kanji_id,
  p.status AS srs_status,
  p.ease_factor,
  p.interval,
  p.repetitions,
  p.reading_stage,
  COALESCE(AVG(CASE WHEN rl.review_type = 'meaning'
    AND rl.reviewed_at > NOW() - INTERVAL '30 days'
    THEN (rl.quality >= 3)::int END), 0) AS meaning_accuracy,
  COALESCE(AVG(CASE WHEN rl.review_type = 'reading'
    AND rl.reviewed_at > NOW() - INTERVAL '30 days'
    THEN (rl.quality >= 3)::int END), 0) AS reading_accuracy,
  COUNT(CASE WHEN rl.quality < 3 THEN 1 END) AS total_failures,
  COUNT(CASE WHEN rl.quality < 3
    AND rl.reviewed_at > NOW() - INTERVAL '14 days'
    THEN 1 END) AS recent_failures,
  AVG(rl.response_time_ms) AS avg_response_time_ms,
  MAX(CASE WHEN rl.quality < 3 THEN rl.reviewed_at END) AS last_failed_at,
  (COUNT(CASE WHEN rl.quality < 3
    AND rl.reviewed_at > NOW() - INTERVAL '14 days'
    THEN 1 END) >= 4
  OR COUNT(CASE WHEN rl.quality < 3 THEN 1 END) >= 8) AS is_leech
FROM user_kanji_progress p
LEFT JOIN review_logs rl
  ON rl.kanji_id = p.kanji_id AND rl.user_id = p.user_id
GROUP BY p.user_id, p.kanji_id, p.status, p.ease_factor,
         p.interval, p.repetitions, p.reading_stage;

CREATE UNIQUE INDEX idx_kanji_mastery_pk
  ON kanji_mastery_view(user_id, kanji_id);

-- Refresh strategy: incremental refresh after each user's session submit
-- Use REFRESH MATERIALIZED VIEW CONCURRENTLY in a post-session hook
```

---

## 5. API Endpoints

All new endpoints under `/v1/buddy/...` namespace.

### 5.1 Buddy Core

```
GET  /v1/buddy/state
  → LearnerStateCache
  Returns the current learner state snapshot. Cached.

POST /v1/buddy/refresh-state
  → { computedAt: timestamp }
  Forces recomputation of the learner state cache.

GET  /v1/buddy/nudges?screen=dashboard
  → BuddyNudge[]
  Returns active, undismissed nudges for the given screen.

POST /v1/buddy/nudges/:id/dismiss
  → { ok: true }
  Marks a nudge as dismissed.

POST /v1/buddy/nudges/:id/acted
  → { ok: true }
  Records that the user acted on a nudge (tapped its action button).

POST /v1/buddy/message
  → BuddyResponse
  Body: { context, message?, payload? }
  Synchronous interactive call. Used for "user taps Buddy" flows.

POST /v1/buddy/event
  → { processed: true }
  Body: { eventType, payload }
  Reports a trigger event from the client (e.g., card_failed).
```

### 5.2 Study Plan

```
GET  /v1/buddy/study-plan
  → StudyPlan
  Returns the active plan or generates a new one if expired.

POST /v1/buddy/study-plan/generate
  → StudyPlan
  Forces generation of a new plan.

POST /v1/buddy/study-plan/:planId/activity/:index/event
  → { ok: true }
  Body: { event: 'started' | 'completed' | 'skipped' | 'navigated_away' }
  Reports activity progress.
```

### 5.3 Co-Creation

```
POST /v1/buddy/cocreation/start
  → CoCreationSession
  Body: { kanjiId }
  Initiates a co-creation flow. Returns session ID and first prompt.

POST /v1/buddy/cocreation/:sessionId/respond
  → CoCreationStage
  Body: { stage, response, location? }
  Submits a response and gets the next stage.

POST /v1/buddy/cocreation/:sessionId/finalize
  → SavedMnemonic
  Body: { mnemonicText (final, possibly user-edited) }
  Saves the resulting mnemonic.
```

### 5.4 Study Log

```
GET  /v1/study-log?view=timeline&filter=...
  → StudyLogEntry[]
  Lists log entries with optional filters (tag, mood, kanji, date range).

GET  /v1/study-log/:id
  → StudyLogEntry
  Single entry.

POST /v1/study-log
  → StudyLogEntry
  Body: { kanjiId, userNote?, exampleSentence?, photoUrls?, mood?, tags? }
  Creates a new log entry.

PATCH /v1/study-log/:id
  → StudyLogEntry
  Updates an entry.

DELETE /v1/study-log/:id
  → { ok: true }

POST /v1/study-log/:id/photo
  → { photoUrl }
  Multipart upload. Adds a photo to an entry.

POST /v1/study-log/:id/audio
  → { audioUrl }
  Multipart upload. Adds an audio note.

POST /v1/study-log/:id/share
  → { shared: true }
  Toggles sharing with friends.

GET  /v1/study-log/friends
  → SharedStudyLogEntry[]
  Returns log entries shared by friends.

POST /v1/study-log/friends/:id/react
  → { ok: true }
  Body: { reaction: '🎉' | '💡' | '🤝' }
```

### 5.5 Social

```
GET  /v1/buddy/social/signals
  → SocialSignals
  Returns the social signal block from learner state cache.

POST /v1/buddy/social/shared-goal
  → SharedGoal
  Body: { friendId, goalType, target }

GET  /v1/buddy/social/shared-goals
  → SharedGoal[]
```

### 5.6 Onboarding

```
GET  /v1/buddy/onboarding/status
  → { completed: boolean, steps: OnboardingStep[] }

POST /v1/buddy/onboarding/step
  → { nextStep }
  Body: { stepId, response }
```

### 5.7 MCP Server (Phase 8, internal initially)

```
POST /v1/mcp/tools/call
  → { result }
  Body: { tool, input, learnerId }

GET  /v1/mcp/resources/:uri
  → Resource

GET  /v1/mcp/prompts/:name
  → Prompt
```

---

## 6. Mobile App Integration

### 6.1 Buddy Card Component

The `BuddyCard` is the primary UI surface for Buddy nudges. Inline component, not a modal.

```typescript
// apps/mobile/src/components/BuddyCard.tsx

interface BuddyCardProps {
  nudge: BuddyNudge
  onAction: () => void
  onDismiss: () => void
}

// Renders:
// ┌──────────────────────────────────────┐
// │ 🤝 [nudge.content]                  │
// │                                      │
// │ [Action Button]    [Dismiss icon]   │
// └──────────────────────────────────────┘
```

Placement:
- **Dashboard**: Top of scroll view, above velocity metrics
- **Study tab**: Above the study queue, post-session
- **Journal**: When relevant (e.g., post-success annotation prompt)
- **Progress**: Above JLPT bars

Multiple nudges per screen are stacked by priority. Maximum 2 visible at once.

### 6.2 Apple Foundation Models Bridge

```typescript
// apps/mobile/src/services/llm/apple-fm-bridge.ts

import { AppleFoundationModels } from '@react-native-ai/apple'  // or chosen package

export class AppleFoundationProvider implements LLMProvider {
  readonly name = 'apple-foundation-models'
  readonly supportsToolCalling = true
  readonly maxContextTokens = 4096
  readonly estimatedLatencyMs = 200
  readonly costPerInputToken = 0
  readonly costPerOutputToken = 0

  async isAvailable(): Promise<boolean> {
    return AppleFoundationModels.isAvailable()
  }

  async generateCompletion(req: CompletionRequest): Promise<CompletionResult> {
    const startTime = Date.now()
    const result = await AppleFoundationModels.generate({
      systemPrompt: req.systemPrompt,
      messages: req.messages,
      tools: req.tools,
      maxTokens: req.maxTokens,
      temperature: req.temperature
    })
    return {
      content: result.text,
      toolCalls: result.toolCalls,
      finishReason: result.finishReason,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      providerName: this.name,
      latencyMs: Date.now() - startTime
    }
  }
}
```

The actual package and method names depend on which library is chosen during Phase 2. Adapter pattern keeps the interface stable.

### 6.3 Buddy Client

```typescript
// apps/mobile/src/services/buddy-client.ts

export class BuddyClient {
  constructor(
    private apiBase: string,
    private localProvider?: LLMProvider
  ) {}

  async getNudges(screen: BuddyScreen): Promise<BuddyNudge[]> {
    const response = await fetch(`${this.apiBase}/v1/buddy/nudges?screen=${screen}`)
    return response.json()
  }

  async dismissNudge(nudgeId: string): Promise<void> {
    await fetch(`${this.apiBase}/v1/buddy/nudges/${nudgeId}/dismiss`, {
      method: 'POST'
    })
  }

  async generateLocalNudge(context: LocalNudgeContext): Promise<string | null> {
    if (!this.localProvider || !(await this.localProvider.isAvailable())) {
      return null
    }
    const result = await this.localProvider.generateCompletion({
      systemPrompt: buildLocalNudgePrompt(context),
      messages: [{ role: 'user', content: context.prompt }],
      maxTokens: 200,
      temperature: 0.7
    })
    return result.content
  }

  async sendEvent(eventType: string, payload: Record<string, unknown>): Promise<void> {
    await fetch(`${this.apiBase}/v1/buddy/event`, {
      method: 'POST',
      body: JSON.stringify({ eventType, payload })
    })
  }
}
```

### 6.4 Device Type Detection

Each API call includes a `device_type` header so review logs and sessions can be attributed correctly.

```typescript
// apps/mobile/src/services/api-client.ts

import { Platform } from 'react-native'
import * as Device from 'expo-device'

function detectDeviceType(): 'iphone' | 'ipad' | 'watch' {
  if (Device.deviceType === Device.DeviceType.PHONE) return 'iphone'
  if (Device.deviceType === Device.DeviceType.TABLET) return 'ipad'
  // Watch detection happens in the watch app, not here
  return 'iphone'
}

// Add to default headers:
headers: {
  'X-Device-Type': detectDeviceType(),
  ...
}
```

Watch app sends `X-Device-Type: watch` from its own request layer.

---

## 7. Apple Watch Integration

### 7.1 Complication

Watch complication shows daily progress passively:

```
┌─────────────────┐
│  漢字バディ      │
│  ████████░░ 15/20│
│  5 more today    │
│  🔥 Day 12       │
└─────────────────┘
```

Implemented via WidgetKit (already in use). Updates after each Watch session and on data sync from phone.

### 7.2 Watch Nudge Delivery

The phone is the source of truth. Watch nudges are synced via WatchConnectivity:

```
1. Server generates nudge with delivery_target='watch' or 'all'
2. Phone receives nudge in next /v1/buddy/nudges call
3. Phone sends nudge to Watch via WatchConnectivity (as a userInfo transfer)
4. Watch presents notification + complication update
5. Watch records dismissal/action and syncs back to phone
6. Phone calls /v1/buddy/nudges/:id/dismiss or /acted
```

### 7.3 Watch Frequency Cap

Cap enforcement happens server-side when generating nudges:

```typescript
async function generateWatchNudge(userId: string, candidateNudge: BuddyNudge): Promise<boolean> {
  const today = startOfDayInUserTz(userId)
  const todayCount = await db.query.buddyNudges.count({
    where: and(
      eq(buddyNudges.userId, userId),
      isNotNull(buddyNudges.watchDeliveredAt),
      gte(buddyNudges.watchDeliveredAt, today)
    )
  })
  if (todayCount >= 3) return false

  const todaySocialCount = await db.query.buddyNudges.count({
    where: and(
      eq(buddyNudges.userId, userId),
      eq(buddyNudges.socialFraming, true),
      isNotNull(buddyNudges.watchDeliveredAt),
      gte(buddyNudges.watchDeliveredAt, today)
    )
  })
  if (candidateNudge.socialFraming && todaySocialCount >= 1) return false

  return true
}
```

---

## 8. Study Orchestration Engine

### 8.1 Plan Generation

```typescript
// apps/api/src/services/buddy/study-plan.engine.ts

export interface StudyActivity {
  order: number
  type: ActivityType
  kanjiIds?: number[]
  duration: number  // minutes
  reason: string
  loopStage: 1 | 2 | 3 | 4 | 5
  socialFraming?: boolean
  completed: boolean
  skipped: boolean
}

type ActivityType =
  | 'flashcard_review'
  | 'new_kanji'
  | 'quiz'
  | 'writing'
  | 'voice'
  | 'leech_drill'
  | 'mnemonic_review'
  | 'confused_pair_drill'

export async function generateStudyPlan(
  userId: string,
  state: LearnerStateCache
): Promise<StudyPlan> {
  const activities: StudyActivity[] = []
  let order = 0

  // 1. Due reviews always first
  const dueCount = await getDueReviewCount(userId)
  if (dueCount > 0) {
    activities.push({
      order: order++,
      type: 'flashcard_review',
      duration: estimateReviewTime(dueCount),
      reason: `${dueCount} cards due for review`,
      loopStage: 1,
      completed: false,
      skipped: false
    })
  }

  // 2. Leeches with ineffective mnemonics → mnemonic review
  const leechMnemonics = await findLeechesWithIneffectiveMnemonics(userId, state.leechKanjiIds)
  for (const leech of leechMnemonics) {
    activities.push({
      order: order++,
      type: 'mnemonic_review',
      kanjiIds: [leech.kanjiId],
      duration: 3,
      reason: `Current hook for ${leech.character} isn't sticking — let's build a better one`,
      loopStage: 2,
      completed: false,
      skipped: false
    })
  }

  // 3. Other leeches → leech drill
  if (state.activeLeeches > 0) {
    const drillKanji = state.leechKanjiIds.slice(0, 5)
    activities.push({
      order: order++,
      type: 'leech_drill',
      kanjiIds: drillKanji,
      duration: 5,
      reason: `${state.activeLeeches} kanji need extra attention`,
      loopStage: 5,
      completed: false,
      skipped: false
    })
  }

  // 4. Weak modality practice
  if (state.weakestModality === 'writing') {
    const weakKanji = await getWeakWritingKanji(userId, 8)
    if (weakKanji.length > 0) {
      activities.push({
        order: order++,
        type: 'writing',
        kanjiIds: weakKanji.map(k => k.id),
        duration: 10,
        reason: 'Writing practice strengthens visual memory',
        loopStage: 3,
        completed: false,
        skipped: false
      })
    }
  } else if (state.weakestModality === 'reading' || state.weakestModality === 'voice') {
    const weakKanji = await getWeakReadingKanji(userId, 8)
    if (weakKanji.length > 0) {
      activities.push({
        order: order++,
        type: 'voice',
        kanjiIds: weakKanji.map(k => k.id),
        duration: 10,
        reason: 'Speaking readings aloud builds audio memory',
        loopStage: 3,
        completed: false,
        skipped: false
      })
    }
  }

  // 5. Confused pairs
  const confusedPairs = await getConfusedPairs(userId)
  if (confusedPairs.length > 0) {
    activities.push({
      order: order++,
      type: 'confused_pair_drill',
      kanjiIds: confusedPairs.flat().map(p => p.id),
      duration: 5,
      reason: `Drilling ${confusedPairs.map(p => p.map(k => k.character).join('/')).join(', ')} side by side`,
      loopStage: 5,
      completed: false,
      skipped: false
    })
  }

  // 6. Quiz gap → assessment
  if (state.quizVsSrsGapHigh) {
    activities.push({
      order: order++,
      type: 'quiz',
      duration: 5,
      reason: 'Quick quiz to verify what you truly recall vs. recognize',
      loopStage: 4,
      completed: false,
      skipped: false
    })
  }

  // 7. New kanji if reviews are light
  if (dueCount < (await getDailyGoal(userId)) * 0.7) {
    activities.push({
      order: order++,
      type: 'new_kanji',
      duration: 10,
      reason: 'Reviews are light today — good day to learn new kanji',
      loopStage: 1,
      completed: false,
      skipped: false
    })
  }

  // 8. Social nudges (max 1 per plan)
  const socialActivity = await generateSocialActivity(state)
  if (socialActivity) {
    activities.push({ ...socialActivity, order: order++ })
  }

  return {
    id: generateUuid(),
    userId,
    activities,
    rationale: summarizePlan(activities, state),
    scaffoldLevel: state.scaffoldLevel,
    generatedAt: new Date(),
    deviceType: null,  // set on retrieval
    completedCount: 0,
    skippedCount: 0,
    expiresAt: addHours(new Date(), 24)
  }
}
```

### 8.2 Scaffold Level Computation

```typescript
export function computeScaffoldLevel(state: LearnerStateCache): 1 | 2 | 3 {
  const daysSinceFirst = state.daysSinceFirstSession ?? 0
  const totalSeen = state.totalSeen

  if (daysSinceFirst < 14 && totalSeen < 50) return 1  // Guided
  if (daysSinceFirst < 56 && totalSeen < 300) return 2 // Coached
  return 3                                              // Autonomous
}
```

Recomputed on each state cache update.

---

## 9. Contextual Mnemonic Co-Creation

### 9.1 Stage State Machine

```typescript
type CoCreationStage =
  | 'consent'
  | 'location_inference'
  | 'detail_elicitation'
  | 'assembly'
  | 'commitment'

interface CoCreationSession {
  id: string
  userId: string
  kanjiId: number
  stage: CoCreationStage
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
```

### 9.2 Service Implementation

```typescript
// apps/api/src/services/buddy/cocreation.service.ts

export class CoCreationService {
  constructor(
    private llmRouter: BuddyLLMRouter,
    private mnemonicService: MnemonicService,
    private geocoder: GeocodingService
  ) {}

  async start(userId: string, kanjiId: number): Promise<CoCreationSession> {
    // Verify user is allowed (daily cap, not recently declined, etc.)
    await this.checkEligibility(userId, kanjiId)

    return {
      id: generateUuid(),
      userId,
      kanjiId,
      stage: 'consent',
      questions: [],
      answers: [],
      startedAt: new Date()
    }
  }

  async respond(
    sessionId: string,
    response: CoCreationResponse
  ): Promise<CoCreationSession> {
    const session = await this.loadSession(sessionId)

    switch (session.stage) {
      case 'consent':
        return this.handleConsent(session, response)
      case 'location_inference':
        return this.handleLocation(session, response)
      case 'detail_elicitation':
        return this.handleDetail(session, response)
      case 'assembly':
        return this.handleAssembly(session, response)
      case 'commitment':
        return this.handleCommitment(session, response)
    }
  }

  private async handleLocation(
    session: CoCreationSession,
    response: CoCreationResponse
  ): Promise<CoCreationSession> {
    if (response.location) {
      // Round coordinates immediately
      const lat = Math.round(response.location.lat * 1000) / 1000
      const lng = Math.round(response.location.lng * 1000) / 1000

      const placeInfo = await this.geocoder.reverseGeocode(lat, lng)

      session.location = { lat, lng, name: placeInfo.name, type: placeInfo.type }
    } else {
      // User typed a description
      session.location = {
        lat: 0,
        lng: 0,
        name: response.locationDescription ?? 'somewhere',
        type: 'user_described'
      }
    }

    // Generate first detail-elicitation questions
    const kanji = await this.getKanji(session.kanjiId)
    const questions = await this.generateQuestions(kanji, session.location, session.userId)
    session.questions = questions
    session.stage = 'detail_elicitation'

    return this.saveSession(session)
  }

  private async generateQuestions(
    kanji: Kanji,
    location: LocationInfo,
    userId: string
  ): Promise<string[]> {
    const profile = await getLearnerProfile(userId)

    const result = await this.llmRouter.route({
      context: 'mnemonic_question_generation',
      userId,
      systemPrompt: COCREATION_QUESTION_PROMPT,
      messages: [{
        role: 'user',
        content: JSON.stringify({
          kanji: { character: kanji.character, meanings: kanji.meanings,
                   kunReadings: kanji.kunReadings, onReadings: kanji.onReadings,
                   radicals: kanji.radicals },
          location,
          interests: profile.interests
        })
      }],
      maxTokens: 500,
      temperature: 0.8
    })

    return parseQuestions(result.content)  // returns string[]
  }

  private async handleAssembly(
    session: CoCreationSession,
    response: CoCreationResponse
  ): Promise<CoCreationSession> {
    const kanji = await this.getKanji(session.kanjiId)
    const profile = await getLearnerProfile(session.userId)

    const result = await this.llmRouter.route({
      context: 'mnemonic_assembly',
      userId: session.userId,
      systemPrompt: COCREATION_ASSEMBLY_PROMPT,
      messages: [{
        role: 'user',
        content: JSON.stringify({
          kanji: { character: kanji.character, meanings: kanji.meanings,
                   kunReadings: kanji.kunReadings, onReadings: kanji.onReadings,
                   radicals: kanji.radicals },
          location: session.location,
          questionsAndAnswers: session.questions.map((q, i) => ({
            question: q,
            answer: session.answers[i]
          })),
          style: profile.preferredMnemonicStyle
        })
      }],
      maxTokens: 600,
      temperature: 0.9
    })

    session.draftMnemonic = result.content
    session.stage = 'commitment'

    return this.saveSession(session)
  }

  private async handleCommitment(
    session: CoCreationSession,
    response: CoCreationResponse
  ): Promise<CoCreationSession> {
    const finalText = response.finalMnemonicText ?? session.draftMnemonic!

    await this.mnemonicService.create({
      userId: session.userId,
      kanjiId: session.kanjiId,
      type: 'user',
      generationMethod: 'cocreated',
      storyText: finalText,
      locationLat: session.location?.lat,
      locationLng: session.location?.lng,
      locationName: session.location?.name,
      locationType: session.location?.type,
      cocreationContext: {
        questions: session.questions,
        answers: session.answers,
        timeOfDay: getTimeOfDay(),
      },
      effectivenessScore: 0.5
    })

    session.finalMnemonic = finalText
    session.completedAt = new Date()
    return this.saveSession(session)
  }
}
```

### 9.3 Effectiveness Score Updates

```typescript
// Hook into review submit
export async function updateMnemonicEffectiveness(
  userId: string,
  kanjiId: number,
  quality: number
): Promise<void> {
  const mnemonic = await getActiveMnemonicForKanji(userId, kanjiId)
  if (!mnemonic) return

  let delta = 0
  if (quality >= 4) delta = 0.1   // success
  else if (quality < 3) delta = -0.15  // failure
  else delta = 0  // 'hard' grade is neutral

  const newScore = Math.max(0, Math.min(1, mnemonic.effectivenessScore + delta))

  await db.update(mnemonics).set({
    effectivenessScore: newScore,
    lastReinforcedAt: new Date(),
    reinforcementCount: mnemonic.reinforcementCount + 1
  }).where(eq(mnemonics.id, mnemonic.id))
}
```

### 9.4 Reverse Geocoding

```typescript
// apps/api/src/services/buddy/geocoding.service.ts

export class NominatimGeocodingService implements GeocodingService {
  private readonly baseUrl = 'https://nominatim.openstreetmap.org/reverse'

  async reverseGeocode(lat: number, lng: number): Promise<PlaceInfo> {
    // Nominatim usage policy: max 1 req/sec, must include User-Agent
    const response = await fetch(
      `${this.baseUrl}?format=json&lat=${lat}&lon=${lng}&zoom=18`,
      {
        headers: {
          'User-Agent': 'KanjiBuddy/2.0 (kanji-buddy@example.com)'
        }
      }
    )
    const data = await response.json()
    return {
      name: data.display_name?.split(',')[0] ?? 'Unknown location',
      type: this.classifyPlaceType(data),
      city: data.address?.city ?? data.address?.town,
      country: data.address?.country
    }
  }

  private classifyPlaceType(data: NominatimResponse): string {
    if (data.address?.railway) return 'train_station'
    if (data.address?.amenity === 'restaurant') return 'restaurant'
    if (data.address?.amenity === 'cafe') return 'cafe'
    if (data.address?.shop) return 'shop'
    return 'place'
  }
}
```

---

## 10. Study Log

### 10.1 Migration from Existing Mnemonics

The existing `mnemonics` table holds user-authored mnemonics with photo support. Migration to `study_log_entries`:

```sql
INSERT INTO study_log_entries (
  id, user_id, kanji_id, mnemonic_id, photo_urls, location_lat, location_lng,
  created_at, updated_at
)
SELECT
  gen_random_uuid(),
  user_id,
  kanji_id,
  id,
  CASE WHEN image_url IS NOT NULL
    THEN jsonb_build_array(image_url)
    ELSE '[]'::jsonb
  END,
  latitude,
  longitude,
  created_at,
  updated_at
FROM mnemonics
WHERE type = 'user';
```

### 10.2 Photo and Audio Storage

Both use Supabase Storage. Bucket structure:

```
study-log-photos/
  {userId}/
    {entryId}/
      {photoId}.jpg

study-log-audio/
  {userId}/
    {entryId}/
      {audioId}.m4a
```

Photos compressed to 1080p max, JPEG quality 80. Audio capped at 30 seconds, AAC encoding.

Per-user storage cap: 500MB initial, raised on request.

### 10.3 Map View

```typescript
// apps/mobile/src/components/StudyLogMapView.tsx

import MapView, { Marker } from 'react-native-maps'

export function StudyLogMapView({ entries }: { entries: StudyLogEntry[] }) {
  const entriesWithLocation = entries.filter(e => e.locationLat && e.locationLng)

  return (
    <MapView style={{ flex: 1 }}>
      {entriesWithLocation.map(entry => (
        <Marker
          key={entry.id}
          coordinate={{
            latitude: entry.locationLat!,
            longitude: entry.locationLng!
          }}
          title={`${entry.kanjiCharacter} — ${entry.locationName}`}
          description={entry.userNote ?? entry.mnemonicText}
          onPress={() => navigateToEntry(entry.id)}
        />
      ))}
    </MapView>
  )
}
```

---

## 11. Social Learning

### 11.1 Social Signal Computation

```typescript
// apps/api/src/services/buddy/social-signals.service.ts

export async function computeSocialSignals(userId: string): Promise<SocialSignals> {
  const friends = await getFriendList(userId)
  const friendIds = friends.map(f => f.friendId)

  const [
    activeFriendsToday,
    friendStats
  ] = await Promise.all([
    countActiveFriendsToday(friendIds),
    getFriendComparativeStats(userId, friendIds)
  ])

  return {
    friendsCount: friends.length,
    activeFriendsToday,
    friendsAheadOnBurn: friendStats.aheadOnBurn,
    friendsBehindOnBurn: friendStats.behindOnBurn,
    friendsAheadOnStreak: friendStats.aheadOnStreak,
    friendsBehindOnStreak: friendStats.behindOnStreak,
    userStrengthsVsFriends: computeUserStrengths(friendStats),
    groupMomentum: computeGroupMomentum(friendStats)
  }
}
```

### 11.2 Social Nudge Generation

```typescript
// apps/api/src/services/buddy/social-nudge.service.ts

export async function generateSocialNudge(
  state: LearnerStateCache
): Promise<BuddyNudge | null> {
  // RULE: Max 1 social nudge per day
  const todayCount = await countSocialNudgesToday(state.userId)
  if (todayCount >= 1) return null

  // RULE: Skip if user is behind on every metric
  if (isUserStrugglingAcrossBoard(state)) return null

  // Pick the strongest available signal
  if (state.activeFriendsToday >= 2 && state.daysSinceLastSession >= 1) {
    return makeGroupMomentumNudge(state)
  }
  if (state.friendsAheadOnStreak.length > 0 && state.currentStreak < 7) {
    return makeStrengthAffirmationNudge(state)
  }
  // ... other rules

  return null
}

function makeStrengthAffirmationNudge(state: LearnerStateCache): BuddyNudge {
  const friend = state.friendsAheadOnStreak[0]
  const userStrength = state.userStrengthsVsFriends[friend.friendId]

  if (!userStrength) return null  // Skip if no positive frame available

  return {
    nudgeType: 'social_peer',
    content: `${friend.displayName} has a ${friend.streakDays}-day streak — but you're still ahead on ${userStrength}. Don't lose that lead!`,
    watchSummary: `Ahead of ${friend.displayName} on ${userStrength}`,
    socialFraming: true,
    actionType: 'navigate',
    actionPayload: { screen: 'study' },
    priority: 3,
    deliveryTarget: 'all'
  }
}
```

### 11.3 Sharing Mnemonics

```typescript
async function shareStudyLogEntry(entryId: string, userId: string): Promise<void> {
  await db.update(studyLogEntries)
    .set({ sharedWithFriends: true, updatedAt: new Date() })
    .where(and(eq(studyLogEntries.id, entryId), eq(studyLogEntries.userId, userId)))

  // Notify friends via existing notification system
  const friends = await getFriendList(userId)
  for (const friend of friends) {
    await sendInAppNotification(friend.friendId, {
      type: 'friend_shared_log',
      payload: { entryId, sharedBy: userId }
    })
  }
}
```

---

## 12. Universal Knowledge Graph & MCP Server

### 12.1 Synchronization Strategy

Every meaningful event in Kanji Buddy writes to both layers:

```typescript
// Wrapper service used throughout the codebase
export class DualWriteService {
  async recordReviewSubmission(data: ReviewSubmission): Promise<void> {
    // App-specific
    await db.transaction(async tx => {
      await tx.insert(reviewLogs).values(data.log)
      await tx.update(userKanjiProgress).set(data.progressUpdate)
        .where(/* ... */)

      // Universal projection
      await tx.insert(learnerKnowledgeState).values({
        learnerId: data.userId,
        subject: `kanji:${data.kanjiCharacter}`,
        masteryLevel: this.statusToMastery(data.progressUpdate.status),
        status: this.mapStatus(data.progressUpdate.status),
        lastReinforcedAt: new Date(),
        sourceApp: 'kanji_buddy',
        metadata: { srsInterval: data.progressUpdate.interval }
      }).onConflictDoUpdate({
        target: [learnerKnowledgeState.learnerId, learnerKnowledgeState.subject],
        set: {
          masteryLevel: sql`EXCLUDED.mastery_level`,
          status: sql`EXCLUDED.status`,
          lastReinforcedAt: sql`EXCLUDED.last_reinforced_at`,
          metadata: sql`EXCLUDED.metadata`
        }
      })

      await tx.insert(learnerTimelineEvents).values({
        learnerId: data.userId,
        eventType: 'kanji_reviewed',
        subject: `kanji:${data.kanjiCharacter}`,
        payload: { quality: data.log.quality, reviewType: data.log.reviewType },
        sourceApp: 'kanji_buddy'
      })
    })
  }

  private statusToMastery(status: SrsStatus): number {
    switch (status) {
      case 'unseen': return 0.0
      case 'learning': return 0.25
      case 'reviewing': return 0.5
      case 'remembered': return 0.75
      case 'burned': return 1.0
    }
  }
}
```

### 12.2 MCP Server (Phase 8)

```typescript
// apps/api/src/services/mcp/server.ts

export class BuddyMCPServer {
  constructor(private services: BuddyServices) {}

  registerTools(): MCPToolDefinition[] {
    return [
      {
        name: 'get_buddy_context',
        description: 'Get all context needed for Buddy to act on a subject for a learner',
        inputSchema: {
          type: 'object',
          properties: {
            learnerId: { type: 'string' },
            currentSubject: { type: 'string' }
          },
          required: ['learnerId', 'currentSubject']
        },
        handler: async (input) => this.getBuddyContext(input.learnerId, input.currentSubject)
      },
      {
        name: 'get_learner_profile',
        // ...
      },
      {
        name: 'get_knowledge_state',
        // ...
      },
      {
        name: 'get_memory_artifacts',
        // ...
      },
      // ... etc
    ]
  }

  registerResources(): MCPResourceDefinition[] {
    return [
      {
        uri: 'learner://profile/{learnerId}',
        handler: async (params) => this.getLearnerProfile(params.learnerId)
      },
      // ... etc
    ]
  }

  registerPrompts(): MCPPromptDefinition[] {
    return [
      {
        name: 'buddy_system_prompt',
        description: 'The canonical Buddy personality and pedagogical principles',
        handler: async () => BUDDY_SYSTEM_PROMPT_TEMPLATE
      }
    ]
  }
}
```

In Phase 8, this is invoked **internally** by the Buddy Agent. In a future phase, OAuth 2.0 authentication wraps this for external clients.

### 12.3 Backfill Job

```typescript
// One-time job to populate the universal layer for existing users
async function backfillUniversalLayer(): Promise<void> {
  const users = await db.select().from(userProfiles)

  for (const user of users) {
    // Identity
    await db.insert(learnerIdentity).values({
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      nativeLanguage: null,
      targetLanguages: ['ja']
    }).onConflictDoNothing()

    // Universal profile (initially sparse, filled by onboarding later)
    await db.insert(learnerProfileUniversal).values({
      learnerId: user.id,
      buddyPersonalityPref: 'encouraging'
    }).onConflictDoNothing()

    // Knowledge state from existing progress
    const progress = await db.select().from(userKanjiProgress)
      .where(eq(userKanjiProgress.userId, user.id))

    for (const p of progress) {
      const kanji = await getKanjiById(p.kanjiId)
      await db.insert(learnerKnowledgeState).values({
        learnerId: user.id,
        subject: `kanji:${kanji.character}`,
        masteryLevel: statusToMastery(p.status),
        status: mapStatus(p.status),
        firstSeenAt: p.createdAt,
        lastReinforcedAt: p.lastReviewedAt,
        sourceApp: 'kanji_buddy',
        metadata: { srsInterval: p.interval, easeFactor: p.easeFactor }
      }).onConflictDoNothing()
    }

    // Memory artifacts from existing mnemonics
    const userMnemonics = await db.select().from(mnemonics)
      .where(and(eq(mnemonics.userId, user.id), eq(mnemonics.type, 'user')))

    for (const m of userMnemonics) {
      const kanji = await getKanjiById(m.kanjiId)
      await db.insert(learnerMemoryArtifacts).values({
        learnerId: user.id,
        subject: `kanji:${kanji.character}`,
        artifactType: 'mnemonic',
        content: { storyText: m.storyText, imageUrl: m.imageUrl },
        context: { lat: m.latitude, lng: m.longitude },
        effectivenessScore: 0.5,
        sourceApp: 'kanji_buddy'
      }).onConflictDoNothing()
    }

    // Connections from existing friendships
    const friendships = await db.select().from(friendships)
      .where(or(
        eq(friendships.requesterId, user.id),
        eq(friendships.addresseeId, user.id)
      ))

    for (const f of friendships) {
      if (f.status !== 'accepted') continue
      const [a, b] = [f.requesterId, f.addresseeId].sort()
      await db.insert(learnerConnections).values({
        learnerIdA: a,
        learnerIdB: b,
        relationship: 'friend',
        sharedApps: ['kanji_buddy']
      }).onConflictDoNothing()
    }
  }
}
```

---

## 13. Privacy & Security

### 13.1 Location Data

- **Permission scope:** Foreground only. Never `Location.requestBackgroundPermissionsAsync()`.
- **Coordinate precision:** Round to 3 decimal places (~100m) before storing.
- **Retention:** Coordinates purged 30 days after creation; only `location_name` retained long-term.
- **User control:** Per-entry deletion in Study Log; settings toggle to disable location features entirely.
- **LLM prompts:** Include directive "Do not repeat exact coordinates in your response."

### 13.2 Photo and Audio

- **Storage:** Supabase Storage with row-level security (RLS): only the owner can read.
- **No automated analysis:** No face recognition, no content classification.
- **Compression:** Photos to 1080p JPEG q80; audio to 30s AAC.
- **Per-user cap:** 500MB initial, monitored for abuse.

### 13.3 Social Privacy

- **Friend data scope:** Buddy may only reference data already visible on the leaderboard (burn count, streak, recent activity timestamps).
- **No friend struggles:** Failures, leeches, or low scores of friends are never used in nudges without explicit opt-in.
- **Sharing is opt-in per entry:** No bulk sharing.

### 13.4 LLM Privacy

- **No PII in prompts:** Email, full coordinates, and friend identifiers are not passed to LLM providers.
- **Display name OK:** First name only used in prompts.
- **No conversation persistence with provider:** Each LLM call is stateless from the provider's perspective.
- **Opt-out:** Users can disable cloud LLM features entirely (falls back to templates only).

### 13.5 MCP Server Auth (Phase 8+)

- **Closed registry:** App ID + secret pre-registered. No public sign-up.
- **Per-app consent:** Learner explicitly grants each app, with scope visibility.
- **Revocation:** Single-screen, immediate effect.
- **Audit log:** All MCP requests logged with `learnerId`, `appId`, `timestamp`, `tool/resource`, `result status`.

---

## 14. Implementation Phasing

Each phase has a clear deliverable, acceptance criteria, and risk profile. See the design document section 14 for the high-level phasing. The detailed implementation plan (with task breakdowns) is produced separately by the writing-plans skill at the start of each phase.

**Phase 0 — Foundation**
- Schema migrations (all new tables, alterations to existing)
- LLMRouter + provider implementations (Apple FM stub, Groq, Gemini, refactored Claude)
- LearnerStateService (cache population, post-session refresh hook)
- Dual-write to universal Knowledge Graph
- Backfill job for existing users
- Telemetry: per-tier latency and success rates

**Phase 1 — Template-Based Buddy**
- BuddyNudgeService with template library
- BuddyCard component on Dashboard, Study, Progress
- Watch nudge delivery via WatchConnectivity
- Watch complication update (passive progress)
- Frequency caps (3/day Watch, 1/day social)
- Analytics dashboard for nudge performance

**Phase 2 — Apple Foundation Models**
- Integration of `@react-native-ai/apple` (or chosen package)
- AppleFoundationProvider client implementation
- Device capability detection
- On-device session summary generation
- Graceful degradation on unsupported devices

**Phase 3 — Study Orchestration Engine**
- StudyPlanEngine implementation
- Study plan UI on Dashboard
- Cross-tab navigation with context payloads
- Scaffold level computation
- Leech detection
- Confused pair detection
- Quiz vs SRS gap analysis

**Phase 4 — Social Learning**
- Social signal extraction
- Social nudge generation with framing rules
- Shared goals
- Friend rescue interventions
- Watch social nudges with split cap

**Phase 5 — Contextual Mnemonic Co-Creation**
- CoCreationService and stage state machine
- Co-creation UI flow
- NominatimGeocodingService
- Effectiveness score updates on review
- Daily co-creation cap

**Phase 6 — Study Log**
- study_log_entries table + migration
- Photo upload (Supabase Storage)
- Audio recording and upload
- Multiple view modes (timeline, map, kanji, tag, mood)
- Buddy nudges to annotate
- Friend sharing

**Phase 7 — Onboarding**
- Onboarding flow UI
- Profile data collection
- SRS explanation
- Existing user gentle prompt

**Phase 8 — MCP Server Internal**
- MCP server implementation
- Tool definitions
- Refactor Buddy Agent to use MCP tools

**Phase 9 — Claude Integration (Optional)**
- ClaudeProvider in router
- Opt-in UI
- Per-user daily caps
- Budget monitoring

**Phase 10 — Android (Optional)**
- Expo Android build
- GeminiNanoProvider native module
- UI adjustments
- Wear OS equivalent (or deferred)

---

## 15. Testing Strategy

### 15.1 Unit Tests

- LLMRouter classification logic
- StudyPlanEngine generation rules
- Social nudge framing rule enforcement
- Effectiveness score calculation
- Coordinate rounding
- Scaffold level computation

### 15.2 Integration Tests

- Dual-write transaction integrity
- Backfill job correctness
- LLM provider failover
- Co-creation flow end-to-end (with mocked LLM)
- Watch nudge frequency cap enforcement

### 15.3 Manual / Beta Testing

- Apple Foundation Models on real device (cannot be fully mocked)
- Reverse geocoding accuracy
- Buddy tone perception (qualitative)
- Social nudge appropriateness (qualitative)
- Watch notification fatigue (longitudinal)

### 15.4 Performance Tests

- Learner state cache refresh latency (<200ms target)
- Study plan generation latency (<200ms target)
- LLM router overhead (<50ms beyond provider time)
- MCP server overhead vs. direct DB (<50ms)

### 15.5 Privacy Tests

- Location data not present in stored mnemonics after 30 days
- LLM prompts do not contain PII
- RLS policies prevent cross-user data access
- MCP grants honored on revocation

---

## 16. Open Decisions

1. **Specific React Native package for Apple Foundation Models** — `@react-native-ai/apple` vs `expo-apple-intelligence` vs custom bridge. Decide at start of Phase 2 based on package maturity.

2. **MCP server transport** — In-process Fastify plugin vs. separate process. Decide at start of Phase 8.

3. **Premium tier business model** — Subscription, one-time purchase, freemium split, or no premium tier. Decide before Phase 9.

4. **Android on-device approach** — Wait for community React Native package vs. write custom native module vs. cloud-only. Decide at start of Phase 10.

5. **Beta program structure** — Internal only, closed beta, or open beta. Decide at start of Phase 1.

---

## Appendix A: Type Definitions

Complete TypeScript types for all Buddy domain objects:

```typescript
// packages/shared/src/buddy-types.ts

export type BuddyScreen = 'dashboard' | 'study' | 'journal' | 'write' | 'speak' | 'progress'

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

export interface BuddyNudge {
  id: string
  userId: string
  screen: BuddyScreen
  nudgeType: NudgeType
  content: string
  watchSummary?: string
  actionType?: 'navigate' | 'start_drill' | 'view_kanji' | 'generate_mnemonic' | 'dismiss' | 'none'
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

export interface LearnerStateCache {
  userId: string
  computedAt: Date
  currentStreak: number
  velocityTrend: 'accelerating' | 'steady' | 'decelerating' | 'inactive'
  totalSeen: number
  totalBurned: number
  activeLeeches: number
  leechKanjiIds: number[]
  weakestModality?: 'meaning' | 'reading' | 'writing' | 'voice' | 'compound'
  strongestJlptLevel?: string
  currentFocusLevel?: string
  avgDailyReviews: number
  avgSessionDurationMs: number
  daysSinceLastSession: number
  quizVsSrsGapHigh: boolean
  primaryDevice?: DeviceType
  deviceDistribution: Record<DeviceType, number>
  watchSessionAvgCards?: number
  recentMilestones: Milestone[]
  studyPatterns: StudyPatterns
  nextRecommendedActivity?: string
  buddyMood: 'celebratory' | 'supportive' | 'challenging' | 'concerned'
  scaffoldLevel: 1 | 2 | 3
  friendsCount: number
  activeFriendsToday: number
  friendsAheadOnBurn: FriendComparison[]
  friendsBehindOnBurn: FriendComparison[]
  friendsAheadOnStreak: FriendComparison[]
  friendsBehindOnStreak: FriendComparison[]
  userStrengthsVsFriends: Record<string, string>
  groupMomentum?: 'rising' | 'steady' | 'falling'
}

export interface FriendComparison {
  friendId: string
  displayName: string
  metric: string
  value: number
  delta: number
}

export interface StudyPatterns {
  preferredTime?: 'morning' | 'midday' | 'evening' | 'night'
  avgSessionsPerDay: number
  weekendVsWeekdayRatio: number
}

export interface Milestone {
  type: string
  achievedAt: Date
  payload: Record<string, unknown>
}

export interface StudyPlan {
  id: string
  userId: string
  activities: StudyActivity[]
  rationale: string
  scaffoldLevel: 1 | 2 | 3
  generatedAt: Date
  deviceType?: DeviceType
  completedCount: number
  skippedCount: number
  expiresAt: Date
}

export interface StudyActivity {
  order: number
  type: 'flashcard_review' | 'new_kanji' | 'quiz' | 'writing' | 'voice'
      | 'leech_drill' | 'mnemonic_review' | 'confused_pair_drill'
  kanjiIds?: number[]
  duration: number
  reason: string
  loopStage: 1 | 2 | 3 | 4 | 5
  socialFraming?: boolean
  completed: boolean
  skipped: boolean
}

export interface CoCreationSession {
  id: string
  userId: string
  kanjiId: number
  stage: 'consent' | 'location_inference' | 'detail_elicitation' | 'assembly' | 'commitment'
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
  mood?: 'aha' | 'struggle' | 'breakthrough' | 'fun' | 'confused'
  sharedWithFriends: boolean
  createdAt: Date
  updatedAt: Date
  lastViewedAt?: Date
}
```

---

## Appendix B: Configuration

Environment variables added in Phase 0:

```
# LLM Providers
GROQ_API_KEY=                      # Free tier key from console.groq.com
GEMINI_API_KEY=                    # Free tier key from aistudio.google.com
ANTHROPIC_API_KEY=                 # Existing, used for Claude tier
LLM_PRIMARY_TIER2_PROVIDER=groq    # 'groq' or 'gemini'
LLM_TIER3_ENABLED=false            # Set true when Claude tier launched

# Per-user limits
BUDDY_TIER2_DAILY_CAP_PER_USER=50
BUDDY_TIER3_DAILY_CAP_PER_USER=2
BUDDY_COCREATION_DAILY_CAP=2

# Geocoding
NOMINATIM_USER_AGENT=KanjiBuddy/2.0 (your-email@example.com)
NOMINATIM_BASE_URL=https://nominatim.openstreetmap.org

# Watch
WATCH_NUDGE_DAILY_CAP=3
WATCH_SOCIAL_NUDGE_DAILY_CAP=1

# MCP (Phase 8+)
MCP_INTERNAL_ONLY=true             # Phase 8 only
MCP_OAUTH_CLIENT_REGISTRY=         # JSON list of allowed apps
```

---

*End of technical specification. See `2026-04-09-kanji-buddy-design.md` for the human-readable design document.*
