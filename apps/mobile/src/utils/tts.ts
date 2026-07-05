import * as Speech from 'expo-speech'

/** Resolved best-voice identifiers, keyed by language tag. `undefined` means
 *  "looked, none better than the system default" — cached so we only enumerate
 *  voices once per language per app launch. */
const cache = new Map<string, string | undefined>()

/**
 * Best installed voice for a BCP-47 language tag ('en-US', 'ja-JP').
 *
 * iOS ships compact (robotic) voices by default and exposes downloaded
 * Enhanced voices via getAvailableVoicesAsync — preferring those is a free,
 * dramatic TTS quality upgrade on devices that have one. Returns undefined
 * (= system default) when no Enhanced voice for the language is installed.
 * Siri voices are never exposed to third-party apps.
 */
export async function getBestVoice(language: string): Promise<string | undefined> {
  if (cache.has(language)) return cache.get(language)
  try {
    const voices = await Speech.getAvailableVoicesAsync()
    const enhanced = voices.find(
      (v) => v.language === language && v.quality === Speech.VoiceQuality.Enhanced
    )
    cache.set(language, enhanced?.identifier)
    return enhanced?.identifier
  } catch {
    cache.set(language, undefined)
    return undefined
  }
}
