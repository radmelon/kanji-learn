import * as Location from 'expo-location'
import { tryGetCoordsForCapture } from '../utils/location'

export interface PlaceResult { name: string; latitude?: number; longitude?: number }

/** Foreground coords → reverse-geocoded place name. Returns null if location is
 *  unavailable/denied so the flow falls back to a text question. Never throws. */
export async function getPlaceName(): Promise<PlaceResult | null> {
  const coords = await tryGetCoordsForCapture()
  if (!coords) return null
  try {
    const [place] = await Location.reverseGeocodeAsync({ latitude: coords.lat, longitude: coords.lon })
    const name = place?.city || place?.district || place?.region || place?.country
    if (!name) return null
    return { name, latitude: coords.lat, longitude: coords.lon }
  } catch {
    return null
  }
}
