# Seed output

Build-time artifacts from the vocab and sentence seed scripts. Not committed
beyond this README (see `.gitignore`) — these files document per-run
behavior and are regenerated on every seed invocation.

## What lives here

- `seed-warnings-YYYY-MM-DD.json` — structured output from
  `enrich-vocab.ts` runs. Includes per-kanji summary counts, rejection
  details (kanji doesn't contain itself — closes B4), below-floor kanji
  with fewer than 3 accepted entries, and pitch-accent coverage stats.

## When to read these

- After a seed run, to verify the rejection set is plausible and no kanji
  dropped below the floor.
- When debugging unexpected vocab in production: find the relevant run's
  JSON and check what was accepted vs rejected.

## Floor behavior

`enrich-vocab.ts` exits nonzero if any kanji has fewer than 3 accepted
entries. Override during development with `--allow-below-floor`.
