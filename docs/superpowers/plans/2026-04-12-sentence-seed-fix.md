# Sentence Seed Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `seed-sentences.ts` so it produces near-100% sentence coverage across all 2,294 kanji instead of the current ~0%.

**Architecture:** Three targeted changes to a single seed script: relax the Tatoeba sentence length filter from 40 to 60 chars, add retry logic with logging to the Claude Haiku fallback, and reduce concurrency from 4 to 2. No schema, API, or UI changes needed — sentences appear automatically in the app once the DB is populated.

**Tech Stack:** TypeScript, tsx, Tatoeba REST API, Anthropic SDK (`claude-haiku-4-5-20251001`), Drizzle ORM, PostgreSQL

---

## Files

- Modify: `packages/db/src/seeds/seed-sentences.ts`

---

### Task 1: Relax Tatoeba filter and reduce concurrency

**Files:**
- Modify: `packages/db/src/seeds/seed-sentences.ts:37-41`

- [ ] **Step 1: Update the config constants**

In `packages/db/src/seeds/seed-sentences.ts`, replace lines 37–41:

```ts
// BEFORE:
const CONCURRENCY = 4
const TATOEBA_DELAY_MS = 300     // ~3 req/s to be polite
const RETRY_LIMIT = 3
const BASE_DELAY_MS = 1_500
const MAX_SENTENCE_JP_CHARS = 40 // keep sentences short/learner-friendly

// AFTER:
const CONCURRENCY = 2
const TATOEBA_DELAY_MS = 300     // ~3 req/s to be polite
const RETRY_LIMIT = 3
const BASE_DELAY_MS = 1_500
const MAX_SENTENCE_JP_CHARS = 60 // 60 chars captures most learner-friendly sentences
const CLAUDE_RETRY_LIMIT = 3
const CLAUDE_BASE_DELAY_MS = 2_000
```

- [ ] **Step 2: Verify the diff is correct**

Run:
```bash
grep -n "CONCURRENCY\|MAX_SENTENCE\|CLAUDE_RETRY" packages/db/src/seeds/seed-sentences.ts
```

Expected output:
```
37:const CONCURRENCY = 2
41:const MAX_SENTENCE_JP_CHARS = 60 // 60 chars captures most learner-friendly sentences
42:const CLAUDE_RETRY_LIMIT = 3
43:const CLAUDE_BASE_DELAY_MS = 2_000
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/seeds/seed-sentences.ts
git commit -m "fix(seed): relax sentence length filter to 60 chars, reduce concurrency to 2"
```

---

### Task 2: Add retry logic and logging to Claude fallback

**Files:**
- Modify: `packages/db/src/seeds/seed-sentences.ts` — `generateFallback` function (lines 113–142)

- [ ] **Step 1: Replace `generateFallback` with a retrying version**

Replace the entire `generateFallback` function (lines 113–142) with:

```ts
async function generateFallback(k: KanjiRow): Promise<Sentence[]> {
  if (!anthropic) return []
  const vocab = k.exampleVocab[0]
  if (!vocab) return []

  const prompt = `Write one short, simple Japanese example sentence (under 30 characters) using the word "${vocab.word}" (${vocab.reading}, meaning: ${vocab.meaning}). The sentence should be appropriate for JLPT ${k.jlptLevel} level learners.

Return ONLY a JSON object with exactly these keys:
{
  "ja": "the Japanese sentence",
  "en": "the English translation"
}
No markdown, no extra text.`

  for (let attempt = 0; attempt < CLAUDE_RETRY_LIMIT; attempt++) {
    try {
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      })
      const text = (msg.content[0] as any).text?.trim() ?? ''
      const parsed = JSON.parse(text)
      if (parsed.ja && parsed.en) {
        return [{ ja: parsed.ja, en: parsed.en, vocab: vocab.word }]
      }
      process.stdout.write(`⚠️  Claude fallback for ${k.character}: unexpected response shape\n`)
      return []
    } catch (err: any) {
      const isLast = attempt === CLAUDE_RETRY_LIMIT - 1
      process.stdout.write(
        `⚠️  Claude fallback for ${k.character} (attempt ${attempt + 1}/${CLAUDE_RETRY_LIMIT}): ${err?.message ?? err}\n`
      )
      if (!isLast) await sleep(CLAUDE_BASE_DELAY_MS * 2 ** attempt)
    }
  }
  return []
}
```

Key changes from original:
- Uses `CLAUDE_RETRY_LIMIT` and `CLAUDE_BASE_DELAY_MS` constants (defined in Task 1)
- Logs the actual error message and attempt number on every failure
- Retries up to 3× with 2s → 4s → 8s backoff before giving up

- [ ] **Step 2: Verify the file compiles cleanly**

```bash
cd packages/db && npx tsc --noEmit
```

Expected: no errors output.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/seeds/seed-sentences.ts
git commit -m "fix(seed): add retry logic and error logging to Claude fallback"
```

---

### Task 3: Run the seed and verify coverage

- [ ] **Step 1: Run the seed**

```bash
pnpm --filter @kanji-learn/db seed:sentences
```

Watch the output. You should now see far fewer `⚠️` lines. Any Claude fallback failures will show the actual error (e.g. `429 Too Many Requests`) instead of silently skipping.

Expected final summary (approximate):
```
✅  Done
   Tatoeba sentences : ~600–900
   Claude fallback   : ~1200–1500
   Skipped/failed    : <50
   Total with data   : 2200+ / 2294
```

- [ ] **Step 2: Spot-check 魚 in the DB**

```bash
psql "postgresql://postgres.pyltysrcqvskxgumzrlg:uG551EufZCpCXLVr@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres" \
  -c "SELECT character, example_sentences FROM kanji WHERE character = '魚';"
```

Expected: `example_sentences` is a non-empty JSON array with at least one `{ ja, en, vocab }` entry.

- [ ] **Step 3: Check overall coverage**

```bash
psql "postgresql://postgres.pyltysrcqvskxgumzrlg:uG551EufZCpCXLVr@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres" \
  -c "SELECT COUNT(*) FILTER (WHERE example_sentences != '[]'::jsonb) AS with_sentences, COUNT(*) AS total FROM kanji;"
```

Expected: `with_sentences` ≥ 2200.

- [ ] **Step 4: Update bug #5 in BUGS.md**

Change Bug #5 status line from:
```
`[Effort: S]` `[Impact: High]` `[Status: 🐛 Active — seed running, coverage will be poor]`
```
to:
```
`[Effort: S]` `[Impact: High]` `[Status: ✅ Fixed — re-seeded with relaxed filter + Claude retry]`
```

- [ ] **Step 5: Commit**

```bash
git add BUGS.md
git commit -m "fix(seed): resolve sparse coverage — relaxed filter + Claude retry, re-seeded"
git push origin main
```
