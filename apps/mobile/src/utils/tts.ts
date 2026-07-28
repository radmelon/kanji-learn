import * as Speech from 'expo-speech'
import { segmentByScript } from '../lib/script-segments'

/** Resolved best-voice identifiers, keyed by language tag. Only *hits* are
 *  cached — see getBestVoice for why caching a miss was a bug. */
const cache = new Map<string, string>()

/**
 * Best installed voice for a BCP-47 language tag ('en-US', 'ja-JP').
 *
 * iOS ships compact (robotic) voices by default and exposes downloaded
 * Enhanced voices via getAvailableVoicesAsync — preferring those is a free,
 * dramatic TTS quality upgrade on devices that have one. Returns undefined
 * (= system default) when no Enhanced voice for the language is installed.
 * Siri voices are never exposed to third-party apps.
 *
 * B-212(c): this used to cache misses as well as hits — `cache.set(language,
 * enhanced?.identifier)` stored `undefined`, and the subsequent `cache.has`
 * short-circuited every later call. A learner who followed the advice to
 * install a better voice saw no change until they force-quit the app, with
 * nothing telling them so. Misses are no longer cached, so the very next
 * Speak-it picks up a newly installed voice. The cost is re-enumerating
 * voices only on devices that have none — exactly the devices where the
 * enumeration is cheapest and the upgrade matters most.
 */
export async function getBestVoice(language: string): Promise<string | undefined> {
  const hit = cache.get(language)
  if (hit) return hit
  try {
    const voices = await Speech.getAvailableVoicesAsync()
    const enhanced = voices.find(
      (v) => v.language === language && v.quality === Speech.VoiceQuality.Enhanced
    )
    if (enhanced) cache.set(language, enhanced.identifier)
    return enhanced?.identifier
  } catch {
    return undefined
  }
}

// ─── Mixed ja/en narration ────────────────────────────────────────────────────

/** Bumped on every new call so a fresh tap cancels an in-flight narration
 *  instead of interleaving with it. */
let generation = 0

/**
 * Speak mixed ja/en prose, switching voice per run.
 *
 * Sequential rather than concatenated because expo-speech takes one language
 * per utterance. Each segment resolves on `onDone`, and also on `onStopped` /
 * `onError` — otherwise a stop mid-narration would hang the chain forever.
 */
export async function speakMixed(text: string, opts?: { rate?: number }): Promise<void> {
  const gen = ++generation
  Speech.stop()

  for (const segment of segmentByScript(text)) {
    if (gen !== generation) return
    const language = segment.lang === 'ja' ? 'ja-JP' : 'en-US'
    const voice = await getBestVoice(language)
    if (gen !== generation) return

    await new Promise<void>((resolve) => {
      Speech.speak(segment.text, {
        language,
        voice,
        rate: opts?.rate ?? 0.95,
        onDone: () => resolve(),
        onStopped: () => resolve(),
        onError: () => resolve(),
      })
    })
  }
}
