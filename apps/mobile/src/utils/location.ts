import * as Location from 'expo-location'

export type CapturedCoords = {
  lat: number
  lon: number
  accuracy?: number
}

/**
 * Best-effort foreground location capture for opt-in features.
 * Returns null on permission denial, hardware off, or timeout — never throws.
 */
export async function tryGetCoordsForCapture(): Promise<CapturedCoords | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync()
    if (!perm.granted) return null
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    })
    return {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? undefined,
    }
  } catch {
    return null
  }
}
