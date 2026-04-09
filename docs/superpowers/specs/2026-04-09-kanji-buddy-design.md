# Kanji Buddy: Design Document

**Version:** 2.0 (successor to Kanji Learn)
**Date:** April 9, 2026
**Status:** Approved for implementation
**Author:** R. Dennis (with Claude)

---

## 1. Vision

Kanji Buddy is a Japanese learning companion built around a simple premise: **a buddy is a friend who is always there to help, support, and encourage.** Where Kanji Learn version 1 gave learners a powerful set of tools — flashcards, quizzes, writing practice, voice practice, social features, analytics — Kanji Buddy adds the missing piece: an intelligent learning coach that ties those tools together into a coherent, personalized journey.

The goal is not to replace any of the existing functionality. It is to **link** it. Today, a learner opens Kanji Learn and decides for themselves: do I do flashcards? Take a quiz? Practice writing? Each tab is a standalone tool. Kanji Buddy makes those tabs feel like stations in a connected journey, with Buddy as the guide who knows where you've been, where you're struggling, and where to go next.

This document explains the philosophy, the architecture, and the user experience of Kanji Buddy. A companion technical specification (`2026-04-09-kanji-buddy-spec.md`) contains the implementation details.

---

## 2. The Problem with Version 1

Kanji Learn is a fully functional, production-ready SRS app. It tracks rich data about each learner: SRS grades, ease factors, response times, quiz results, writing scores, voice attempts, daily aggregates, velocity metrics, and more. But that data is **observed, not acted upon**.

Three specific weaknesses motivated the redesign:

**1. Disconnected functional areas.** The seven tabs — Dashboard, Study, Journal, Write, Speak, Progress, Profile — each work well in isolation but don't communicate. Quiz performance doesn't influence what flashcards appear next. A learner who consistently fails reading recall is never nudged toward voice practice. The Journal sits as a personal scrapbook, disconnected from the learning loop. There is no orchestrating intelligence linking these capabilities together.

**2. Generic encouragement.** The app shows velocity metrics and milestone badges, but it doesn't speak to the learner as an individual. There is no mechanism for noticing that a particular learner is struggling, asking *why*, and adjusting the approach. A real friend studying alongside you would notice these things. The app doesn't.

**3. Stock mnemonics that don't stick.** AI-generated mnemonics (Claude Haiku and Sonnet) are a strong feature, but they are written in the abstract. When a learner repeatedly fails the same kanji despite the mnemonic, there's no path forward except trying harder. Research is clear: self-generated, personally meaningful mnemonics dramatically outperform assigned ones. The app doesn't help learners build their own.

Kanji Buddy addresses each of these directly.

---

## 3. Theoretical Foundation

Kanji Buddy is grounded in **constructivist learning theory**: the belief that learning is a process of constructing new knowledge by connecting it to existing knowledge and experience. We do not memorize random symbols; we build memory by linking the unfamiliar to the familiar.

This has three concrete implications for the design:

**Personally meaningful mnemonics.** A mnemonic is only as effective as the connection it creates. A story about a generic monk holding a tea cup means nothing to a learner who has never seen a monk or a temple. But a story about *the yellow vending machine you can see right now at Beppu Station, with a monk stepping out next to it holding green tea* — that is unforgettable, because it lives in the learner's actual experience.

**Scaffolding with calibrated fading.** Vygotsky's Zone of Proximal Development tells us that the right level of support is "what the learner can almost do alone." A good tutor provides enough help to enable progress, then gradually withdraws support as competence grows. AI tutoring research consistently identifies *failure to fade scaffolding* as a major weakness — many systems create dependency by continuing to help when the learner could now manage alone. Buddy must calibrate: more guidance for new learners, more autonomy for experienced ones.

**Learning is social.** Vygotsky also emphasized that learning is co-constructed through social interaction. The existing friendship and study team features in Kanji Learn are an underused asset. Buddy should leverage them — celebrating peers' wins, encouraging mutual support, gently using peer comparison to motivate without shaming.

These principles are not abstract slogans. They drive specific design decisions throughout this document.

---

## 4. Who Buddy Is

Buddy is a character. Not a chatbot, not an assistant, not a coach in the corporate sense — a **friend**. A friend who happens to know a great deal about Japanese kanji, who has been studying alongside you, who notices when you're struggling and when you're crushing it, who celebrates your wins and shows up when you've been quiet for too long.

Buddy's voice is warm but honest. Buddy doesn't deal in empty praise. "Great job!" is the language of corporate apps. Buddy says things like:

> "You finally got 食. Add a note about what clicked — you'll want to remember this."

> "Grant has a 23-day streak going, but you're still ahead of him on N3. Don't lose that lead."

> "持 again. Remember the monk at Beppu Station with the tea? Close your eyes for 5 seconds and picture it. What was in his hand?"

Buddy is **specific**, **data-informed**, and **personal**. Buddy refers to shared history, knows your friends, knows your struggles, knows what worked for you before. Buddy is brief — mobile screens are small and a real friend doesn't lecture.

Each learner can choose Buddy's personality on a spectrum: **encouraging**, **direct**, or **playful**. The underlying knowledge and pedagogical principles stay the same; only the tone shifts.

---

## 5. The Learning Loop

The single biggest design decision in Kanji Buddy is the **Learning Loop** — a five-stage cycle that links the existing tabs into a coherent journey:

```
1. INTRODUCE  →  2. ANCHOR  →  3. REINFORCE  →  4. ASSESS  →  5. ADAPT  →  back to 1
   (Study)        (Journal)      (Write/Speak)    (Quiz)         (Buddy)
```

**Stage 1 — Introduce:** New kanji enter the learner's world via flashcards in the Study tab. SRS scheduling determines when each one is reviewed.

**Stage 2 — Anchor:** When a kanji is failing to stick, Buddy brings the learner to the Journal tab to build (or rebuild) a memory hook — a mnemonic that connects the kanji to something the learner already knows or can see.

**Stage 3 — Reinforce:** Multi-modal practice in Write and Speak tabs. Writing a kanji by hand strengthens visual memory. Speaking its readings aloud strengthens audio memory. These modes catch what flashcards alone miss.

**Stage 4 — Assess:** Quizzes verify true recall (not just recognition). The Quiz tab reveals gaps that the SRS algorithm can't see — a kanji you grade as "Good" on a flashcard might fail when tested in a different format.

**Stage 5 — Adapt:** Buddy synthesizes everything — flashcard performance, quiz gaps, writing scores, voice accuracy — and adjusts the plan. Maybe the learner needs more reading practice. Maybe two kanji are getting confused with each other and need to be drilled side by side. Maybe a mnemonic isn't working and needs to be rebuilt.

The cycle then repeats. Mastered kanji move on; problem kanji loop back through earlier stages with adjusted approaches.

This is not a new screen. It is not a wizard. The five stages map exactly onto the existing tabs. What's new is that **Buddy guides the learner through the loop**, suggesting which tab to visit next based on what the data reveals about that specific learner's needs at that specific moment.

---

## 6. Adaptive Scaffolding

Buddy adjusts how much structure it provides based on the learner's maturity. There are three levels:

**Level 1 — Guided** (new learners, first 2 weeks or under 50 kanji seen): Buddy presents a step-by-step study plan as a checklist. After each activity, Buddy says "Great! Next up: writing practice." Explanations are explicit ("Writing practice helps because...") so the learner understands *why* each activity matters. The five stages of the learning loop are introduced gently as the learner first encounters each one.

**Level 2 — Coached** (intermediate, 2-8 weeks or 50-300 kanji seen): The study plan becomes a set of suggestions, not a checklist. The learner can reorder or skip activities. Buddy nudges only for high-priority items: leeches that need attention, modalities that are getting weak, friends who just hit a milestone. Less explanation, more data. "Your reading accuracy is 58% this week. Voice practice?" replaces "Try voice practice — it builds audio memory."

**Level 3 — Autonomous** (experienced, 8+ weeks or 300+ kanji seen): The study plan is available but not pushed. Buddy intervenes only for significant signals — new leeches, modality imbalance growing, velocity drop, milestone reached. Buddy respects the learner's established routines. Occasional challenges appear: "Ready to try N3 kanji?" The relationship has become a partnership of equals.

Scaffolding level is computed automatically from the learner's history. Learners who demonstrate self-directed exploration (navigating to multiple tabs without prompting) advance faster. Buddy never stops the learner from doing something on their own.

---

## 7. The Signature Feature: Contextual Mnemonic Co-Creation

When a learner repeatedly fails the same kanji despite trying to memorize the stock mnemonic, the standard response in most apps is "try harder." In Kanji Buddy, Buddy steps in:

> "持 is giving you trouble (4 fails). The current hook isn't sticking. Let's build one together using where you are right now."

If the learner taps "Let's do it," Buddy initiates a five-stage interactive flow. Buddy asks for permission to use the learner's location (foreground only, one-time). If granted, Buddy uses reverse geocoding to identify the place — "Looks like you're at Beppu Station in Japan. Perfect — lots of good imagery to work with. Look around for a moment. Ready?"

Then Buddy asks two to four targeted questions, designed to extract vivid sensory details that can be woven into a mnemonic:

> "Look north from where you're standing. What's the most interesting thing you see? A sign, a building, a vending machine — anything that catches your eye."

> "What color is your shirt today?"

> "Imagine a monk stepping out of a temple right there at the station. What's he holding in his hand?"

Each question serves a specific role in mnemonic construction. The "anchor" question establishes a vivid physical scene. The "personal detail" question injects unique sensory memory. The "radical imagery" question maps the kanji's components onto the scene. The "phonetics" question builds wordplay around the readings.

The learner answers naturally:

> "There's a big yellow vending machine with a picture of green tea on it."
> "Blue."
> "A hot tea. He's holding a tea cup."

Buddy then synthesizes a mnemonic that incorporates everything:

> "You're standing at Beppu Station in your blue shirt. A monk in plain robes walks out of a temple-like alcove next to the yellow vending machine. In his HAND (扌), he's holding (持) a warm cup of green tea he just bought. 'もつ, motsu,' he murmurs, 'this is what I hold.' He offers you a sip. The vending machine beeps: 'ジ... ジ...' — as if blessing the exchange."

Buddy asks the learner to read it aloud — even a whisper — because reading aloud engages more of the brain and locks the memory in harder. The mnemonic is saved with full context: location, time, the questions asked, the answers given, the resulting effectiveness score (which updates as the learner succeeds or fails with it over time).

The next time the learner fails 持, Buddy doesn't immediately rebuild. It **reinforces**:

> "持 again. Remember the monk at Beppu Station with the tea? Close your eyes for 5 seconds and picture it. What was in his hand?"

This is spaced retrieval of the mnemonic itself. Only after repeated failures despite the personalized hook does Buddy offer to rebuild from scratch.

For learners who decline location access, the flow is identical from stage 3 onward — Buddy asks the learner to describe their surroundings in words. No one is excluded from the feature.

This is, in our view, the most distinctive feature of Kanji Buddy. It treats the learner not as a passive recipient of information but as an active participant in constructing memory. It draws on the learner's actual physical environment to root abstract symbols in concrete experience. And it transforms a moment of failure into a moment of personal investment.

---

## 8. The Study Log

The Journal tab is reimagined as the **Study Log** — a personal record of each learner's memory journey, not just a list of mnemonics.

Every Study Log entry is a **memory artifact**. The mnemonic text is the spine, but the learner can add layers of personal context:

- **Free-form notes** for reflection ("Finally got this one — the train metaphor clicked.")
- **Example sentences** the learner writes using the kanji, with reading and translation
- **Photos** — multiple per entry. Photo of the place where the mnemonic was born. Photo of the kanji seen in the wild on a sign or menu. Photo of the learner's handwriting practice. Or simply a photo that *feels* connected.
- **Audio notes** — 30-second voice memos. The learner speaks the readings, the mnemonic, or a personal reflection.
- **Tags** — user-defined labels: "travel", "food", "first-100", "homework-help"
- **Mood** — a simple emoji-based marker for each entry: aha, struggle, breakthrough, fun, confused

The Study Log supports multiple viewing modes:

- **Timeline view** — chronological, newest first
- **Map view** — all entries with location data shown as pins on a map. This is the literal Memory Palace: the learner sees their kanji distributed across places they've actually been. Tapping the Beppu Station pin shows 持 and the hook built there.
- **Kanji view** — organized by JLPT level
- **Tag view** — grouped by user labels
- **Mood view** — filter by mood. "Show me all my breakthrough moments" surfaces the aha entries — a motivating gallery for tough days.

Buddy actively encourages Study Log use. After a successful session on a kanji that has no log entry: "持 is stuck in your head now. Want to capture the moment with a photo or note?" After a breakthrough: "You finally got 食! Add a note about what clicked — you'll want to remember this." On anniversaries: "One year ago today you built the Beppu Station hook for 持. Still holding strong — 47 correct recalls since then. Want to revisit it?"

Entries can be **shared with friends** (opt-in, per entry). Friends see them in a Friend Study Log feed and can react with one-tap emoji or copy mnemonics into their own Journal with attribution. The original author's effectiveness score is shared too, so friends know which hooks actually work in practice.

The Study Log is, in essence, the journal of a learning journey — a place the learner returns to not just to review kanji, but to remember *who they were* when they learned each one.

---

## 9. The Watch as a Learning Partner

The existing Apple Watch companion app gains new significance in Kanji Buddy. The Watch is no longer just a complication for quick reviews — it becomes the surface where Buddy nudges the learner throughout the day.

The Watch complication shows **progress toward today's goal** as a passive, glanceable display:

```
┌─────────────────┐
│  漢字バディ      │
│  ████████░░ 15/20│
│  5 more today    │
│  🔥 Day 12       │
└─────────────────┘
```

Every time the learner checks their wrist, they see how close they are. No notification needed — it is encouragement by presence, not interruption.

When notifications are warranted, Buddy uses the wrist for short, timely nudges:

- **Streak at risk** in the evening: "Day 12! 🔥 5 cards to keep it going."
- **Friend active**: "Grant is studying — join him for 10?"
- **Idle too long**: "Haven't studied today. Quick 5-card session?"
- **Milestone**: "100 burned! 🎉"
- **Peer rescue**: "Priya hasn't studied in 4 days. A study session together might help you both."

Watch nudges are capped at **three per day** to prevent notification fatigue. The cap is split: at most one social nudge on the Watch per day. Buddy is selective about what reaches the wrist — only signals that are timely, brief, and actionable.

Kanji Buddy also tracks which device a learner uses for each session — Watch, iPhone, or iPad. This reveals study patterns: a learner who does morning Watch sessions and evening iPhone sessions is a commuter who reviews deeply at home. A learner who uses iPad only on weekends does long deep-study sessions. A learner whose Watch sessions are increasing while app sessions decline is shifting toward micro-sessions. Buddy adapts to each pattern. The Watch isn't a lesser experience; it is a *different* one — micro-sessions, passive progress, and timely wrist-taps.

---

## 10. Social Learning

Kanji Learn already supports friendships, leaderboards, and friend activity. Kanji Buddy fully integrates these into Buddy's reasoning.

The principle: social comparison should **encourage**, not **shame**. A real friend studying alongside you might say "Grant's on a 23-day streak — but you're still ahead of him on N3." A real friend would never say "Grant is beating you." Buddy always frames comparisons with at least one positive angle for the learner.

Seven categories of social nudges, each with a distinct trigger:

- **Peer encouragement**: "Grant just finished a session. Join him for 10 cards?"
- **Strength affirmation**: "Grant's on a 23-day streak — but you're still ahead on N3 kanji. Don't lose that lead!"
- **Group momentum**: "3 of your friends studied today. You're the piece missing."
- **Milestone sharing**: "100 kanji burned! Grant and Priya will see this on the leaderboard. 🎉"
- **Friend celebration**: "Grant just burned his 200th kanji. Send a 🎉?"
- **Gentle challenge**: "You and Grant are tied at 87 kanji. Who burns #88 first?"
- **Rescue call**: "Priya hasn't studied in 4 days. A study session together might help you both."

Buddy also supports **shared goals**: when two friends are both close to the same milestone (both near 100 burned, for example), Buddy can offer "You and Priya could hit 100 together this week." This is opt-in and tracked through a lightweight shared goals system.

Strict rules govern social nudges. Buddy **never** leads with a negative comparison. Buddy **never** compares on metrics where the user is significantly behind across the board (in that case, social comparison is suppressed entirely and intrinsic motivation is used instead). Buddy **never** reveals a friend's failures or struggles without explicit opt-in. **Maximum one social nudge per day** to avoid pressure fatigue. If the learner has no friends, Buddy doesn't nag about adding them. If they unfriend someone, Buddy doesn't push social features at them. Buddy reads the signal.

The social layer amplifies Buddy's core pedagogy: learning is constructed through connection — not just to prior knowledge, but to community. A study buddy who notices your friends, celebrates with you, and carefully frames comparisons is the kind of friend you want by your side.

---

## 11. Cost Architecture: Free for Users

A foundational design constraint: **Kanji Buddy must be free to users**, with no per-user API costs that would force a subscription model. This shapes the entire LLM strategy.

The solution is a **three-tier architecture** that prioritizes free options:

**Tier 1 — On-Device (free, instant, offline):**
On iOS 26, Apple Foundation Models gives any iPhone 15 Pro+ or M1+ iPad direct access to a 3-billion-parameter LLM with no API key, no cloud cost, no internet required. On Android, Google's Gemini Nano via ML Kit GenAI provides equivalent capability on flagship devices (Pixel 9+, Galaxy S24+). These on-device models handle approximately **70% of Buddy interactions**: encouragement messages, session summaries, simple template-enriched nudges, classification, and structured output generation. Apple Foundation Models has a 4K-token context window — enough for the focused tasks Buddy gives it, not enough for deep diagnostic reasoning.

**Tier 2 — Free Cloud (free, fast, online):**
For tasks requiring richer reasoning — mnemonic generation, leech diagnosis, study plan reasoning, contextual hook creation — Buddy escalates to free cloud APIs. **Groq's free tier** provides Llama 3.3 70B at 30 requests/minute and 14,400 requests/day, with blazing speed (300+ tokens/second). **Google's Gemini 2.5 Flash free tier** serves as a fallback. These handle the remaining ~25% of interactions. At Groq's daily limit, Buddy can serve approximately 7,000 active users before hitting any cap.

**Tier 3 — Premium (metered, optional):**
The remaining ~5% of interactions — rich multi-turn mnemonic co-creation, complex diagnostics, creative writing — are best served by premium models like Claude. The architecture **supports** Claude integration but does not require it. The decision to enable Claude depends on a future business model decision: subscription, one-time purchase, advertising, grant funding, or simply foregoing the premium tier entirely. Until then, Tier 2 free cloud handles everything.

**Older devices** (pre-iPhone 15 Pro, mid-range Android) skip the on-device tier and route everything through Tier 2. They get slightly higher latency but no degraded functionality. No learner is ever excluded.

The architecture is **provider-agnostic** through a `BuddyLLMRouter` abstraction. Adding a new provider (Claude, a future open-source model, an updated Apple framework) is a configuration change, not a rewrite. This preserves optionality for future business decisions.

---

## 12. Portability: The Learner Travels with You

A long-term goal: when the next app is built — say, a Japanese reading companion — Buddy should follow the learner across applications. The reading-practice Buddy should already know what kanji the learner has mastered, which mnemonics they built, who their study mates are. The new app shouldn't feel like starting over.

The mechanism is a **Universal Learner Knowledge Graph** stored in PostgreSQL, plus an **MCP (Model Context Protocol) Server** that exposes it to AI clients.

The Knowledge Graph is a set of app-agnostic tables that represent the learner abstractly: their identity, their universal profile (interests, goals, learning style), their connections (friends and study partners), their memory artifacts (mnemonics, notes, sentences, photos), and their knowledge state (what they know, with mastery levels). Critically, the **subject identifiers are namespaced**: kanji are "kanji:持", grammar points are "grammar:te-form", vocabulary is "vocab:持つ". A single knowledge graph can represent learning across multiple domains.

Kanji Buddy writes to both its app-specific tables and the universal graph on every meaningful event. The universal layer is a projection, not a replacement. The SRS internals stay where they are, optimized for SRS. The universal layer is optimized for cross-app generalization.

The MCP server exposes the graph through standard MCP primitives: **tools** (callable functions like `get_buddy_context` and `get_memory_artifacts`), **resources** (queryable data views), and **prompts** (reusable templates including the canonical Buddy system prompt). When a future app starts up, it fetches the same Buddy system prompt — meaning Buddy has the same voice and principles across every application.

The MCP server is **closed**, not open. Only apps you build can connect. Authentication is OAuth 2.0 client credentials with explicit per-app learner consent. The learner sees: "Reading Buddy wants to connect to your Kanji Buddy profile. It will be able to: see what kanji you know, reference your memory hooks, see your study mates, record new learning events. Allow / Not now." Consent is revocable from a single settings screen.

For Phase 1, the MCP server runs **internally** — Kanji Buddy's own Buddy Agent uses it to access learner data through tools rather than direct database queries. This refactor sets up the architecture for external clients without exposing anything externally yet. External access lights up when a second app exists to consume it.

The architecture sketch — Universal Knowledge Graph behind an MCP layer behind app-specific services — is designed for **portability from day one**, even if external clients ship later.

---

## 13. Privacy

Kanji Buddy collects sensitive data — location, study habits, social connections, photos. Privacy is treated as a first-class design concern, not a checkbox.

**Location:**
- Foreground-only access. Never background tracking.
- Coordinates rounded to 3 decimal places (~100m precision) before storage.
- Reverse geocoding happens immediately; only the place name persists long-term. Raw coordinates are purged after 30 days unless the learner opts to keep them.
- Per-mnemonic location data can be deleted from the Study Log at any time.
- The settings toggle "Use location for mnemonics" defaults to **off**. Must be explicitly enabled.

**Photos:**
- Stored in Supabase Storage with the same access controls as existing mnemonic photos.
- No face recognition, no automated analysis.
- Per-photo deletion from the Study Log.

**Social data:**
- Buddy only references friend data that is already visible on the leaderboard.
- A friend's failures, leeches, and struggles are never surfaced without that friend's explicit opt-in.
- Social nudges can be disabled entirely from settings.

**MCP and external apps:**
- Closed registry. Only your own apps can connect.
- Per-app explicit consent with fine-grained scopes.
- Single-screen revocation, immediate effect.

**Data export and deletion:**
- The existing Kanji Learn data export feature (CSV/JSON) extends to all new tables.
- A complete data deletion request removes everything, including artifacts in the universal Knowledge Graph.

---

## 14. Implementation Phasing

Kanji Buddy is built in eleven phases. Each phase delivers user-visible value and builds on the previous. There is no "big bang" release.

**Phase 0 — Foundation (architectural skeleton, no user-visible changes).** Database schema migrations, learner state cache, LLM router with provider implementations, dual-write to universal Knowledge Graph.

**Phase 1 — Template-Based Buddy (first visible nudges, no LLM calls).** Template-driven nudges, BuddyCard UI on Dashboard/Study/Progress, Watch nudge delivery, frequency caps, analytics.

**Phase 2 — Apple Foundation Models Integration (on-device Tier 1).** React Native bridge for Apple Intelligence, on-device session summaries, graceful degradation for older devices.

**Phase 3 — Study Orchestration Engine (the linking).** Study plan generation, scaffolding levels, cross-tab navigation with context, learning loop tracking, leech detection, confused-pair drills.

**Phase 4 — Social Learning Features.** Social signal extraction, seven nudge categories, supportive framing rules, shared goals, friend rescue interventions.

**Phase 5 — Contextual Mnemonic Co-Creation (the signature feature).** Co-creation trigger detection, five-stage flow UI, reverse geocoding, Groq-powered question and mnemonic generation, effectiveness scoring.

**Phase 6 — Study Log (enhanced Journal).** Multi-photo upload, example sentences, audio notes, tags, mood, multiple views (timeline, map, kanji, tag, mood), Buddy nudges to annotate, friend sharing.

**Phase 7 — Onboarding Flow.** New user onboarding, profile data collection, SRS explanation, integration with placement test.

**Phase 8 — MCP Server Internal Use.** Buddy Agent refactored to consume tools via MCP, internal-only authentication, sets up architecture for external apps.

**Phase 9 — Claude Integration (optional).** Pending business model decision. Adds Claude as Tier 3 with opt-in and hard daily caps.

**Phase 10 — Android Support (optional).** Expo Android build, Gemini Nano integration on supported devices, Wear OS equivalent or deferred.

The MVP — Phases 0 through 7 — represents the complete reimagined experience. With AI-assisted development (Claude Code + Sonnet 4.6), realistic timeline is **6-7 weeks**, with an aggressive stretch target of **4 weeks**. Phases 8-10 add another 2-4 weeks depending on scope decisions.

A detailed implementation plan, with task breakdowns and acceptance criteria for each phase, will be produced as a separate document when development begins.

---

## 15. Success Metrics

How we know Kanji Buddy is working:

**Engagement:**
- Daily active user retention up 15% versus Kanji Learn baseline
- Multi-tab usage in 60%+ of sessions (the linking goal)
- Median streak length up 30%

**Learning:**
- 60% of detected leeches resolved within 7 days
- Quiz-vs-SRS gap narrows over time per learner
- New kanji burn rate steady or improved

**Buddy-specific:**
- Nudge action rate above 25%
- Nudge dismissal rate below 15%
- Watch nudges retained (users don't disable Watch notifications)
- Study plan adherence above 50%

**Social:**
- Friend additions per user up 20%
- Co-created mnemonic effectiveness above 0.7 average
- Qualitative beta feedback on social nudge tone

These metrics track *whether the design is working in practice* — not just whether the code runs. They will guide post-launch iteration.

---

## 16. Open Decisions

A few items remain open and will be settled before or during implementation:

1. **Claude business model** — Phase 9 is gated on a decision about how to fund premium LLM calls (subscription, one-time purchase, advertising, grant, or none).
2. **Android timeline and scope** — Phase 10 depends on the maturity of React Native bridges for Gemini Nano. If no usable package exists when Phase 10 starts, the team chooses between writing a native module or shipping cloud-only on Android.
3. **Beta program structure** — Whether to run a closed beta during Phases 1-4, an open beta from Phase 5 onward, or some other structure.
4. **Migration communication** — How to message the Kanji Learn → Kanji Buddy transition to existing users (rebrand notice, in-app tour, opt-in to new features).

These are not architectural decisions and do not change the design. They are operational decisions to be made closer to launch.

---

## 17. Why This Will Work

The core insight is that Kanji Learn already does most things right. The SRS engine is solid. The data collection is rich. The seven tabs cover the right learning modalities. The social and Watch infrastructure exists. The AI mnemonic generation is in place.

What's missing is the **connective intelligence**. The thing that says "you've been doing flashcards for 15 minutes — your accuracy on readings is dropping — let's switch to voice practice for the kanji you missed today." The thing that notices a learner has failed 持 four times despite the mnemonic and offers to build a new one based on the actual yellow vending machine across the train station from where they're sitting. The thing that knows Grant has been studying every day and gently uses that to motivate without shaming.

That thing is Buddy. And Buddy is buildable today, on top of the existing foundation, using free on-device and free cloud LLMs that didn't exist eighteen months ago. Apple Foundation Models on iOS 26 changed the cost equation. Groq's free tier changed the latency equation. The constructivist research on mnemonic generation gives us a clear pedagogical north star. The MCP standard gives us a portability path.

The result is an app that doesn't just track learning — it accompanies it. A buddy who is always there to help, support, and encourage.

---

## Appendix A: Glossary

- **Buddy** — the AI learning companion at the center of the app
- **Buddy Agent** — the server-side LLM-powered reasoning system
- **Buddy Nudge** — a message or suggestion shown to the learner on a specific screen
- **Co-creation** — the interactive flow where the learner and Buddy jointly build a mnemonic
- **Knowledge Graph** — the universal, app-agnostic representation of a learner's knowledge
- **Leech** — a kanji that has been failed repeatedly and is not progressing
- **Learning Loop** — the five-stage cycle (Introduce → Anchor → Reinforce → Assess → Adapt)
- **LLM Router** — the provider-agnostic abstraction that routes requests to on-device, free cloud, or premium LLMs
- **MCP** — Model Context Protocol, the standard for exposing tools and data to AI clients
- **Memory Artifact** — any saved item in the Study Log: mnemonic, note, sentence, photo, audio
- **Nudge Cap** — frequency limit on nudges to prevent overload (3 per day on Watch)
- **Scaffolding Level** — Buddy's adaptive support level (Guided / Coached / Autonomous)
- **SRS** — Spaced Repetition System (the SM-2 algorithm currently powering Kanji Learn)
- **Study Log** — the reimagined Journal tab, a personal record of memory artifacts
- **Tier 1 / 2 / 3** — the three LLM tiers (on-device / free cloud / premium)
- **Universal Learner Profile** — the cross-app representation of a learner

---

## Appendix B: References

The design is grounded in the following research:

- **Constructivist learning theory** — Vygotsky, Zone of Proximal Development; Piaget, schema theory
- **Bayesian and Deep Knowledge Tracing** — Corbett & Anderson; Piech et al. (Stanford, NeurIPS 2015)
- **SMART Mnemonic System** — Balepur et al., EMNLP 2024 (University of Maryland)
- **Interpretable Mnemonic Generation for Kanji** — EMNLP 2025 (arxiv 2507.05137)
- **Adaptive Scaffolding for LLM Pedagogical Agents** — arxiv 2025
- **Method of Loci / Memory Palace research** — VR studies on spatial memory anchoring
- **MASELTOV Project** — context-aware mobile language learning, EU-funded
- **Merrill's First Principles of Instruction** — pedagogical foundation for ICALL
- **Apple Foundation Models** — WWDC 2025, iOS 26 Foundation Models framework
- **Groq Free Tier** — Llama 3.3 70B inference, 30 RPM / 14,400 RPD
- **Model Context Protocol** — Anthropic, November 2024

---

*End of design document. See `2026-04-09-kanji-buddy-spec.md` for technical specifications.*
