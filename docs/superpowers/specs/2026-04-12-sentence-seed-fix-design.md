# Sentence Seed Fix — Design Spec

**Date:** 2026-04-12  
**Bug:** #5 — Example sentence seed produces sparse coverage

---

## Problem

Running `pnpm --filter @kanji-learn/db seed:sentences` processed 2,294 kanji overnight and populated sentences for only 1 (下). Two root causes:

### Root cause 1: Filter too strict (`MAX_SENTENCE_JP_CHARS = 40`)
The Tatoeba results are filtered to sentences ≤40 chars that contain the vocab word verbatim. Most real sentences with compound vocab words (大学、来年、中国) are 15–50 chars. The one kanji that succeeded (下) had a vocab word (地下) that appears in a 9-char sentence ("地下鉄に乗ろう。"). At 40 chars, the vast majority of valid Tatoeba sentences are filtered out.

### Root cause 2: Claude fallback silently fails under load
The `generateFallback()` function has no retry logic and wraps the entire call in a single `try/catch` that returns `[]` on any error with no logging. With 4 concurrent workers making 2,000+ Claude API calls, Anthropic rate limit errors are near-certain. Every rate-limited call silently returns `[]`, logs `⚠️ no sentences found`, and moves on.

---

## Fix

Three targeted changes to `packages/db/src/seeds/seed-sentences.ts`:

### 1. Relax `MAX_SENTENCE_JP_CHARS`: 40 → 60
Increases the Tatoeba hit rate significantly. 60 chars captures the majority of learner-friendly sentences while still filtering out overly complex ones. No other scoring logic changes.

### 2. Add retry logic to `generateFallback`
Wrap the Anthropic call in a retry loop (up to 3 attempts, 2s → 4s → 8s exponential backoff). Log the actual error on each failure so future runs are debuggable. Only return `[]` after all retries are exhausted.

### 3. Reduce `CONCURRENCY`: 4 → 2
Halves simultaneous API pressure on both Tatoeba and Anthropic, reducing the rate-limit error rate. The seed doesn't need to be fast — correctness matters more.

---

## Out of Scope
- Changing the Tatoeba search strategy (searching by kanji character vs. vocab word)
- Using Claude for all kanji instead of as fallback only
- Any UI or API changes
