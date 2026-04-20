# Kanjium — vendored pitch accent dataset

Pitch accent data for Japanese vocabulary, used by the Build 3-C vocab-pitch
seed pipeline (`packages/db/src/seeds/enrich-vocab.ts`).

## Source

- **Upstream:** https://github.com/mifunetoshiro/kanjium
- **File:** `data/source_files/raw/accents.txt`
- **Commit SHA:** `8a0cdaa16d64a281a2048de2eee2ec5e3a440fa6`
- **Snapshotted:** 2026-04-19
- **Size:** 3,226,405 bytes (~3.1 MB)

## License

Kanjium aggregates pitch accent data from multiple public sources, including
Wadoku (CC-BY-SA 4.0). See the upstream repo's `LICENSE` file for details.
Attribution: the Kanjium maintainers and original source contributors
(Wadoku-Projekt et al.).

## Format

Tab-separated values, one entry per line:

```
word<TAB>reading<TAB>accent-pattern
```

Where `accent-pattern` is a numeric digit indicating the pitch-drop position:

- `0` = heiban (no drop; all morae high after mora 1)
- `1` = atamadaka (drop after mora 1; first mora high, rest low)
- `N >= 2` = nakadaka/odaka (drop after mora N)

Some entries list multiple patterns separated by commas — in that case we take
the first (dictionary-primary, Tokyo-standard) per the Build 3-C design.

## Refresh policy

Re-vendor whenever the upstream has materially more coverage of JLPT-range
vocab. Update both the file and this README's commit SHA atomically; do not
edit the vendored file in place. Seed output can always re-run against a
refreshed snapshot without schema changes.
