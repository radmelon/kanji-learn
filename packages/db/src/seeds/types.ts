// Seed data shape — matches the `kanji` table schema
export interface KanjiSeedEntry {
  character: string
  strokeCount: number
  meanings: string[]
  onReadings: string[]  // katakana  e.g. ['ニチ', 'ジツ']
  kunReadings: string[] // hiragana, dot marks okurigana split e.g. 'たの.しい'
  radicals: string[]
  exampleVocab: { word: string; reading: string; meaning: string }[]
}
