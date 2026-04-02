import AsyncStorage from '@react-native-async-storage/async-storage'

export const storage = {
  async getItem<T>(key: string): Promise<T | null> {
    try {
      const raw = await AsyncStorage.getItem(key)
      if (raw == null) return null
      return JSON.parse(raw) as T
    } catch (err) {
      console.warn('[storage] getItem error', key, err)
      return null
    }
  },

  async setItem(key: string, value: unknown): Promise<void> {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value))
    } catch (err) {
      console.warn('[storage] setItem error', key, err)
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key)
    } catch (err) {
      console.warn('[storage] removeItem error', key, err)
    }
  },
}
